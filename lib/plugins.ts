import fs from 'fs';
import path from 'path';
import SwaggerParser from '@apidevtools/swagger-parser';
import { OpenAPI } from 'openapi-types';
import { AIPluginTool } from 'langchain/tools';
import { OpenApiToolkit } from 'langchain/agents';

const PLUGINS_BASE_DIR = path.join(process.cwd(), 'plugins');


export async function getPlugins(): Promise<GPTPlugin[]> {
  const plugins: GPTPlugin[] = [];

  // Look for directories under /plugins - each directory must contain a ai-plugin.json file and an openapi.yaml file
  const pluginBaseDirContents = fs.readdirSync(PLUGINS_BASE_DIR);

  // Filter out anything that's not a directory
  const pluginDirs = pluginBaseDirContents.filter((pluginName) => {
    const pluginPath = path.join(PLUGINS_BASE_DIR, pluginName);
    return fs.statSync(pluginPath).isDirectory();
  });

  // Validate the plugin files in each directory
  await Promise.all(pluginDirs.map(async (pluginName) => {
    try {
      // attempt to load the ai-plugin.json file
      const pluginConfigData = fs.readFileSync(path.join(PLUGINS_BASE_DIR, pluginName, 'ai-plugin.json'), 'utf-8');
      const pluginConfig: AIPluginSpec = JSON.parse(pluginConfigData);

      // console.log("=== PLUGIN CONFIG", pluginConfig);

      // attempt to load the openapi.yaml file
      const openapiSpecPath = path.join(PLUGINS_BASE_DIR, pluginName, 'openapi.yaml');
      // Use SwaggerParser to validate the openapi.yaml file
      const openapiSpec = await SwaggerParser.validate(openapiSpecPath);

      // console.log("=== OPENAPI SPEC", openapiSpec);

      const newPlugin = {
        name: pluginName,
        aiPlugin: pluginConfig,
        openApiSpec: openapiSpec
      };

      // Add the validated plugin to the list of plugins
      plugins.push(newPlugin);

      console.log("=== PLUGIN ADDED", newPlugin.name);

    } catch (error) {
      console.error(`Error loading plugin ${pluginName} verify that ai-plugin.json and openapi.yaml exist are valid.`);
    }
  }));

  // console.log("=== PLUGINS VALIDATED", plugins);

  return plugins;
}


// Define a type that contains all the info for an OpenAI plugin
export interface GPTPlugin {
  name: string;           // this is taken from the directory name under /plugins
  aiPlugin: AIPluginSpec; // this is the ai-plugin.json
  openApiSpec: any;       // this should be OpenAPI.Document, but I can't get the types to work
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
