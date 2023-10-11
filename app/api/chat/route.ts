// Based on example from here: https://sdk.vercel.ai/docs/guides/providers/openai-functions

import OpenAI from 'openai';
import { OpenAIStream, StreamingTextResponse } from 'ai';
import { GPTPlugin, getPlugins } from '@/lib/plugins';
import { functionsFromPlugin } from '@/lib/functions';
import { resolveObjectURL } from 'buffer';

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

    const functions : OpenAI.Chat.Completions.ChatCompletionCreateParams.Function[] = [];

    // Iterate over all the plugins and store in the functions object
    plugins.forEach((plugin) => {
        const pluginFunctions = functionsFromPlugin(plugin);
        functions.push(...pluginFunctions);
    });

    console.log('=== FUNCTIONS', JSON.stringify(functions, null, 2));

    console.log('messages', messages);

    const response = await openai.chat.completions.create({
        model: 'gpt-4',
        stream: true,
        messages,
        functions: functions
    });

    const stream = OpenAIStream(response, {
        experimental_onFunctionCall: async (
            { name, arguments: args },
            createFunctionCallMessages,
        ) => {
            // NEXTJS: if you skip the function call and return nothing, the `function_call`
            // message will be sent to the client for it to handle

            console.log("=== GPT CALLING FUNCTION", name, args);

            // figure out which plugin the function belongs to
            const pluginName = name.split('_')[0];
            const functionName = name.split('_')[1];

            // get the URL for the given plugin and function
            const plugin = plugins.find((p) => p.name === pluginName);
            if (!plugin) {
                throw new Error(`Plugin ${pluginName} not found`);
            }

            // console.log('=== OPENAPI SPEC', plugin.openApiSpec);

            // for each path/method in the openapi spec, 
            // find the operationId that matches the function name
            for (const path in plugin.openApiSpec.paths) {
                for (const method in plugin.openApiSpec.paths[path]) {
                    const operation = plugin.openApiSpec.paths[path][method];

                    if (operation.operationId === functionName) {

                        console.log('=== OPERATION FOUND', operation);

                        // Call the API
                        const URL = plugin.openApiSpec.servers[0].url + path;
                        console.log('=== FETCHING: ', URL);
                        const res = await fetch(URL, {
                            method: method,
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(args)
                        });

                        const resJson = await res.json();

                        console.log('=== RESPONSE', resJson);

                        // `createFunctionCallMessages` constructs the relevant "assistant" and "function" messages for you
                        const newMessages = createFunctionCallMessages(resJson);
                        return openai.chat.completions.create({
                            messages: [...messages, ...newMessages],
                            stream: true,
                            model: 'gpt-4',
                            // see "Recursive Function Calls" below
                            functions,
                        });
                    }
                }
            }
            
            // If we get here, we didn't find the function
            throw new Error(`Function ${name} not found`);
        },
    });


    return new StreamingTextResponse(stream);
}



