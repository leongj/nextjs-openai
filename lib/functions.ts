import OpenAI from 'openai';
import { GPTPlugin, AIPluginSpec } from './plugins';


/**
 * Takes a GPTPlugin object and returns an array of Function objects
 * constructed from the plugin's openapiSpec property.
 *
 * @param plugin - The GPTPlugin object to extract functions from.
 * @returns An array of Function objects.
 */

export function functionsFromPlugin(plugin: GPTPlugin): 
    OpenAI.Chat.Completions.ChatCompletionCreateParams.Function[] {
  const functions: OpenAI.Chat.Completions.ChatCompletionCreateParams.Function[] = [];

  console.log('=== GETTING FUNCTIONS FROM PLUGIN', plugin)

  const spec = plugin.openApiSpec;

  // console.log('=== OPENAPI SPEC', spec)

  // Iterate over all the paths in the openapiSpec property.
  Object.keys(spec.paths).forEach((pathId) => {
    // console.log('== pathId', pathId)
    const path = spec.paths[pathId];

    // Iterate over all the operations in the path.
    Object.keys(path).forEach((method) => {
      // console.log('== method', method)
      const operation = path[method];
      const parameters = operation.parameters || [];
      const requestBody = operation.requestBody;

      // console.log('== operation', operation);
      // console.log('== parameters', parameters);
      // console.log('== requestBody', requestBody);

      // Construct a Function object from the operation.
      // To create unique function names across all plugins, we use "plugin name_operationId".
      //    OpenAI Function def accepts '^[a-zA-Z0-9_-]{1,64}$' as a valid name.
      const functionObj: OpenAI.Chat.Completions.ChatCompletionCreateParams.Function = {
        name: plugin.name + "_" + operation.operationId,
        description: operation.summary,
        parameters: requestBody.content['application/json'].schema,
      };

      // console.log('== functionObj created', functionObj);

      // Add the constructed Function object to the array of functions.
      functions.push(functionObj);
    });
  });

  return functions;
}