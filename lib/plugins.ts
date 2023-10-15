import fs from 'fs';
import path from 'path';
import SwaggerParser from '@apidevtools/swagger-parser';
import { OpenAPI } from 'openapi-types';
import type { OpenAI as OpenAIClient } from "openai";
import { OpenAPISpec } from './openapi-spec';
import { parseOpenAPISpec, convertOpenAPISpecToOpenAIFunctions } from './openapi-functions';

const PLUGINS_BASE_DIR = path.join(process.cwd(), 'plugins');


export async function getPlugins(): Promise<GPTPlugin[]> {
  const plugins: GPTPlugin[] = [];

  // Look for directories under /plugins - each directory must contain a ai-plugin.json file and an openapi.yaml file
  const pluginBaseDirContents = fs.readdirSync(PLUGINS_BASE_DIR);

  console.log("\n=== LOADING PLUGINS FROM:", PLUGINS_BASE_DIR);

  // Filter out anything that's not a directory
  const pluginDirs = pluginBaseDirContents.filter((pluginName) => {
    const pluginPath = path.join(PLUGINS_BASE_DIR, pluginName);
    return fs.statSync(pluginPath).isDirectory();
  });

  // This was an attemp to load the openapi.yaml file and parse it using the Langchain OpenAPI chain code
  // const yamlpath = path.join(PLUGINS_BASE_DIR, 'speak/openapi.yaml');
  // const specdata = fs.readFileSync(yamlpath, 'utf-8');
  // const spec = parseOpenAPISpec(specdata);
  // const functions = convertOpenAPISpecToOpenAIFunctions(spec);
  // console.log("=== FUNCTIONS", JSON.stringify(functions, null, 2));

  // Validate the plugin files in each directory
  await Promise.all(pluginDirs.map(async (pluginDir) => {
    try {
      // attempt to load the ai-plugin.json file
      const pluginConfigData = fs.readFileSync(path.join(PLUGINS_BASE_DIR, pluginDir, 'ai-plugin.json'), 'utf-8');
      const pluginConfig: AIPluginSpec = JSON.parse(pluginConfigData);
     
      // Look for openapi.yaml or openapi.json file and read in as string
      const openapiSpecPathYaml = path.join(PLUGINS_BASE_DIR, pluginDir, 'openapi.yaml');
      const openapiSpecPathJson = path.join(PLUGINS_BASE_DIR, pluginDir, 'openapi.json');
      let openApiSpecData;
      try {
        openApiSpecData = fs.readFileSync(openapiSpecPathYaml, 'utf-8');
      } catch (error) {
        try {
          openApiSpecData = fs.readFileSync(openapiSpecPathJson, 'utf-8');
        } catch (error) {
          console.error(`Error loading openapi.yaml or openapi.json for plugin ${pluginDir}.`);
          return;
        }
      }

      const newPlugin = {
        name: pluginConfig.name_for_human,
        aiPlugin: pluginConfig,
        openApiSpec: openApiSpecData
      };

      // Add the validated plugin to the list of plugins
      plugins.push(newPlugin);

      console.log("=== ADDED PLUGIN:", newPlugin.name, "from", PLUGINS_BASE_DIR + "/" + pluginDir);

    } catch (error) {
      console.error(`Error loading plugin "${PLUGINS_BASE_DIR}/${pluginDir}" verify that ai-plugin.json and openapi.yaml exist are valid.`);
    }
  }));

  return plugins;
}


// Define a type that contains all the info for an OpenAI plugin
export type GPTPlugin = {
  name: string;           
  aiPlugin: AIPluginSpec; 
  openApiSpec: string;       
}

// Define a type that contains all the info for an OpenAI plugin (ai-plugin.json)
export interface AIPluginSpec {
  schema_version: string;
  name_for_human: string;
  name_for_model: string;
  description_for_human: string;
  description_for_model: string;
  // TODO: accept different auth types
  auth: {
    type: string;
  };
  api: {
    type: string;
    url: string;
  };
  logo_url: string;
  contact_email: string;
  legal_info_url: string;
}
