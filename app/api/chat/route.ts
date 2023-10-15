// Based on example from here: https://sdk.vercel.ai/docs/guides/providers/openai-functions

import OpenAI from 'openai';
import { OpenAIStream, StreamingTextResponse } from 'ai';
import { GPTPlugin, getPlugins } from '@/lib/plugins';
import type { OpenAI as OpenAIClient } from "openai";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { BaseCallbackHandler } from "langchain/callbacks";
import { AIMessage, BaseMessage, BaseMessageFields, ChatGeneration } from 'langchain/schema';
import { createOpenAPIChain } from "langchain/chains";
import { convertOpenAPISpecToOpenAIFunctions, functionsFromPlugin, parseOpenAPISpec } from '@/lib/openapi-functions';
import { OpenAPISpec } from '@/lib/openapi-spec';
import { resolveObjectURL } from 'buffer';
import { parse } from 'path';

const resource = process.env['AZURE_OPENAI_API_INSTANCE_NAME'];
const deployment = process.env['AZURE_OPENAI_API_DEPLOYMENT_NAME'];
const apiVersion = process.env['AZURE_OPENAI_API_VERSION'];
const apiKey = process.env['AZURE_OPENAI_API_KEY'];

// Create an OpenAI API client (that's edge friendly!)
const openai = new OpenAI({
    apiKey,
    baseURL: `https://${resource}.openai.azure.com/openai/deployments/${deployment}`,
    defaultQuery: { 'api-version': apiVersion },
    defaultHeaders: { 'api-key': apiKey },
});

// IMPORTANT! Set the runtime to edge
// This was used in the Vercel OpenAI tutorial, but now that I'm reading stuff from
// local filesystem, we can't do this
// export const runtime = 'edge';


// And use it like this:
export async function POST(req: Request) {
    const { messages } = await req.json();

    const plugins: GPTPlugin[] = await getPlugins();

    const pluginsAsFns: OpenAIClient.Chat.Completions.ChatCompletionCreateParams.Function[] = [];

    // Iterate over all the plugins and store in the functions object
    plugins.forEach(async (plugin) => {

        // Check the length of the description, and truncate if necessary
        const FN_DESC_MAX_CHARS = 1024; // Limit enforced by ChatCompletions API
        let pluginDesc;
        if (plugin.aiPlugin.description_for_model.length > FN_DESC_MAX_CHARS) {
            console.log(`=== WARNING: Description for Plugin "${plugin.aiPlugin.name_for_model}" is too long, truncating to ${FN_DESC_MAX_CHARS} chars`);
        } else {
            pluginDesc = plugin.aiPlugin.description_for_model;
        }

        const newFunc: OpenAIClient.Chat.Completions.ChatCompletionCreateParams.Function = {
            name: plugin.aiPlugin.name_for_model,
            description: pluginDesc,
            parameters: { "type": "object", "properties": {} },
        };
        pluginsAsFns.push(newFunc);
    });

    console.log('\n=== MESSAGES', messages);

    // Call to completion API
    const response = await openai.chat.completions.create({
        model: 'gpt-4',
        stream: true,
        messages,
        functions: pluginsAsFns.length > 0 ? pluginsAsFns : undefined,
    });

    const stream = OpenAIStream(response, {
        experimental_onFunctionCall: async (
            { name, arguments: args },
            createFunctionCallMessages,
        ) => {
            // NEXTJS: if you skip the function call and return nothing, the `function_call`
            // message will be sent to the client for it to handle

            console.log("\n=== GPT CALLED PLUGIN:", name, args);

            // Check the plugins to ensure that the function exists
            const plugin = plugins.find((p) => p.aiPlugin.name_for_model === name);
            if (!plugin) {
                throw new Error(`Plugin ${name} not found`);
            }

            console.log("=== PLUGIN FOUND", plugin.aiPlugin.name_for_model);

            /**
             * Use Langchain Functions + OpenAPI chain to call the API
             */ 
            // Define a callback handler on the LLM so we can capture the function call it wants to make
            // and show it to the user
            const handlers = BaseCallbackHandler.fromMethods({
                handleLLMEnd(outputs) {
                    const llmGenerations = outputs.generations as ChatGeneration[][];
                    const llmMessage = llmGenerations[0][0].message as AIMessage;
                    console.log("=== GPT FUNCTION CALL: ", llmMessage.additional_kwargs.function_call);
                }
            });

            const chatModel = new ChatOpenAI({ temperature: 0, callbacks: [handlers] });

            // TODO: pass full chat history to the chain
            const chain = await createOpenAPIChain(plugin.openApiSpec, {
                llm: chatModel,
                // verbose: true,
            });

            const lastMessage = messages[messages.length - 1].content;
            console.log("=== INPUT MESSAGE: ", lastMessage);
            // OpenAPI chain will return the JSON result from the API call
            const apiResult = await chain.run(lastMessage);

            console.log("=== API RESPONSE: ", apiResult, "\n\n")

            // `createFunctionCallMessages` constructs the relevant "assistant" and "function" messages for you
            const newMessages = createFunctionCallMessages(apiResult);
            return openai.chat.completions.create({
                messages: [...messages, ...newMessages],
                stream: true,
                model: 'gpt-4',
                // allow recursive function calls (at the Plugin level)
                functions: pluginsAsFns,
            });
        },
    });


    return new StreamingTextResponse(stream);
}



