/**
 * Use this to convert the OpenAPI spec into a set of OpenAI functions.
 * First use parseOpenAPISpec(), to get a OpenAPISpec object
 * Then use convertOpenAPISpecToOpenAIFunctions()
 * 
 * This code is from Langchain's OpenAI Functions chain
 * https://github.com/langchain-ai/langchainjs/blob/1615dbe4aad5ead0bc78a6833f1d12e08a565b27/langchain/src/chains/openai_functions/openapi.ts
 * 
 * The MIT License
 * 
 * Copyright (c) Harrison Chase
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

import type { OpenAI as OpenAIClient } from "openai";
import type { OpenAPIV3_1 } from "openapi-types";
import { OpenAPISpec } from "./openapi-spec";

import { JsonSchema7ObjectType } from "zod-to-json-schema/src/parsers/object.js";
import { JsonSchema7ArrayType } from "zod-to-json-schema/src/parsers/array.js";
import { JsonSchema7Type } from "zod-to-json-schema/src/parseDef.js";

import { GPTPlugin, AIPluginSpec } from './plugins';


/**
 * Parse an OpenAPI definition from a url, file, or string and create an OpenAPISpec helper object.
 * (Based on code from createOpenAPIChain)
 * @param spec OpenAPISpec or url/text string corresponding to one.
 * @returns OpenAPISpec
 */
export function parseOpenAPISpec(spec: OpenAPIV3_1.Document | string): OpenAPISpec {
  let convertedSpec;
  if (typeof spec === "string") {
    try {
      // Maybe string is a URL
      throw new Error(`Parsing from URL disabled.`);
      // convertedSpec = await OpenAPISpec.fromURL(spec);
    } catch (e) {
      try {
        // Maybe string is a JSON or YAML string
        convertedSpec = OpenAPISpec.fromString(spec);
      } catch (e) {
        throw new Error(`Unable to parse spec from source ${spec}.`);
      }
    }
  } else {
    // Maybe it's an OpenAPIV3.Document obect
    convertedSpec = OpenAPISpec.fromObject(spec);
  }
  return convertedSpec;
}


/**
 * Converts an OpenAPI specification to OpenAI functions.
 * @param spec The OpenAPI specification to convert.
 * @returns An object containing the OpenAI functions derived from the OpenAPI specification and a default execution method.
 */
export function convertOpenAPISpecToOpenAIFunctions(spec: OpenAPISpec): OpenAIClient.Chat.ChatCompletionCreateParams.Function[]
 {
  if (!spec.document.paths) {
    return [];
  }
  const openAIFunctions = [];
  const nameToCallMap: Record<string, { method: string; url: string }> = {};
  for (const path of Object.keys(spec.document.paths)) {
    const pathParameters = spec.getParametersForPath(path);
    for (const method of spec.getMethodsForPath(path)) {
      const operation = spec.getOperation(path, method);
      if (!operation) {
        return [];
      }
      const operationParametersByLocation = pathParameters
        .concat(spec.getParametersForOperation(operation))
        .reduce(
          (
            operationParams: Record<string, OpenAPIV3_1.ParameterObject[]>,
            param
          ) => {
            if (!operationParams[param.in]) {
              // eslint-disable-next-line no-param-reassign
              operationParams[param.in] = [];
            }
            operationParams[param.in].push(param);
            return operationParams;
          },
          {}
        );
      const paramLocationToRequestArgNameMap: Record<string, string> = {
        query: "params",
        header: "headers",
        cookie: "cookies",
        path: "path_params",
      };
      const requestArgsSchema: Record<string, JsonSchema7ObjectType> & {
        data?:
          | JsonSchema7ObjectType
          | {
              anyOf?: JsonSchema7ObjectType[];
            };
      } = {};
      for (const paramLocation of Object.keys(
        paramLocationToRequestArgNameMap
      )) {
        if (operationParametersByLocation[paramLocation]) {
          requestArgsSchema[paramLocationToRequestArgNameMap[paramLocation]] =
            convertOpenAPIParamsToJSONSchema(
              operationParametersByLocation[paramLocation],
              spec
            );
        }
      }
      const requestBody = spec.getRequestBodyForOperation(operation);
      if (requestBody?.content !== undefined) {
        const requestBodySchemas: Record<string, JsonSchema7ObjectType> = {};
        for (const [mediaType, mediaTypeObject] of Object.entries(
          requestBody.content
        )) {
          if (mediaTypeObject.schema !== undefined) {
            const schema = spec.getSchema(mediaTypeObject.schema);
            requestBodySchemas[mediaType] = convertOpenAPISchemaToJSONSchema(
              schema,
              spec
            ) as JsonSchema7ObjectType;
          }
        }
        const mediaTypes = Object.keys(requestBodySchemas);
        if (mediaTypes.length === 1) {
          requestArgsSchema.data = requestBodySchemas[mediaTypes[0]];
        } else if (mediaTypes.length > 1) {
          requestArgsSchema.data = {
            anyOf: Object.values(requestBodySchemas),
          };
        }
      }
      const openAIFunction: OpenAIClient.Chat.ChatCompletionCreateParams.Function =
        {
          name: OpenAPISpec.getCleanedOperationId(operation, path, method),
          description: operation.description ?? operation.summary ?? "",
          parameters: {
            type: "object",
            properties: requestArgsSchema,
            // All remaining top-level parameters are required
            required: Object.keys(requestArgsSchema),
          },
        };

      openAIFunctions.push(openAIFunction);
      const baseUrl = (spec.baseUrl ?? "").endsWith("/")
        ? (spec.baseUrl ?? "").slice(0, -1)
        : spec.baseUrl ?? "";
      nameToCallMap[openAIFunction.name] = {
        method,
        url: baseUrl + path,
      };
    }
  }
  return openAIFunctions;
}

/**
 * Formats a URL by replacing path parameters with their corresponding
 * values.
 * @param url The URL to format.
 * @param pathParams The path parameters to replace in the URL.
 * @returns The formatted URL.
 */
function formatURL(url: string, pathParams: Record<string, string>): string {
  const expectedPathParamNames = [...url.matchAll(/{(.*?)}/g)].map(
    (match) => match[1]
  );
  const newParams: Record<string, string> = {};
  for (const paramName of expectedPathParamNames) {
    const cleanParamName = paramName.replace(/^\.;/, "").replace(/\*$/, "");
    const value = pathParams[cleanParamName];
    let formattedValue;
    if (Array.isArray(value)) {
      if (paramName.startsWith(".")) {
        const separator = paramName.endsWith("*") ? "." : ",";
        formattedValue = `.${value.join(separator)}`;
      } else if (paramName.startsWith(",")) {
        const separator = paramName.endsWith("*") ? `${cleanParamName}=` : ",";
        formattedValue = `${cleanParamName}=${value.join(separator)}`;
      } else {
        formattedValue = value.join(",");
      }
    } else if (typeof value === "object") {
      const kvSeparator = paramName.endsWith("*") ? "=" : ",";
      const kvStrings = Object.entries(value).map(
        ([k, v]) => k + kvSeparator + v
      );
      let entrySeparator;
      if (paramName.startsWith(".")) {
        entrySeparator = ".";
        formattedValue = ".";
      } else if (paramName.startsWith(";")) {
        entrySeparator = ";";
        formattedValue = ";";
      } else {
        entrySeparator = ",";
        formattedValue = "";
      }
      formattedValue += kvStrings.join(entrySeparator);
    } else {
      if (paramName.startsWith(".")) {
        formattedValue = `.${value}`;
      } else if (paramName.startsWith(";")) {
        formattedValue = `;${cleanParamName}=${value}`;
      } else {
        formattedValue = value;
      }
    }
    newParams[paramName] = formattedValue;
  }
  let formattedUrl = url;
  for (const [key, newValue] of Object.entries(newParams)) {
    formattedUrl = formattedUrl.replace(`{${key}}`, newValue);
  }
  return formattedUrl;
}

/**
 * Converts OpenAPI parameters to JSON schema format.
 * @param params The OpenAPI parameters to convert.
 * @param spec The OpenAPI specification that contains the parameters.
 * @returns The JSON schema representation of the OpenAPI parameters.
 */
function convertOpenAPIParamsToJSONSchema(
  params: OpenAPIV3_1.ParameterObject[],
  spec: OpenAPISpec
) {
  return params.reduce(
    (jsonSchema: JsonSchema7ObjectType, param) => {
      let schema;
      if (param.schema) {
        schema = spec.getSchema(param.schema);
        // eslint-disable-next-line no-param-reassign
        jsonSchema.properties[param.name] = convertOpenAPISchemaToJSONSchema(
          schema,
          spec
        );
      } else if (param.content) {
        const mediaTypeSchema = Object.values(param.content)[0].schema;
        if (mediaTypeSchema) {
          schema = spec.getSchema(mediaTypeSchema);
        }
        if (!schema) {
          return jsonSchema;
        }
        if (schema.description === undefined) {
          schema.description = param.description ?? "";
        }
        // eslint-disable-next-line no-param-reassign
        jsonSchema.properties[param.name] = convertOpenAPISchemaToJSONSchema(
          schema,
          spec
        );
      } else {
        return jsonSchema;
      }
      if (param.required && Array.isArray(jsonSchema.required)) {
        jsonSchema.required.push(param.name);
      }
      return jsonSchema;
    },
    {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: {},
    }
  );
}

// OpenAI throws errors on extraneous schema properties, e.g. if "required" is set on individual ones
/**
 * Converts OpenAPI schemas to JSON schema format.
 * @param schema The OpenAPI schema to convert.
 * @param spec The OpenAPI specification that contains the schema.
 * @returns The JSON schema representation of the OpenAPI schema.
 */
export function convertOpenAPISchemaToJSONSchema(
  schema: OpenAPIV3_1.SchemaObject,
  spec: OpenAPISpec
): JsonSchema7Type {
  if (schema.type === "object") {
    return Object.keys(schema.properties ?? {}).reduce(
      (jsonSchema: JsonSchema7ObjectType, propertyName) => {
        if (!schema.properties) {
          return jsonSchema;
        }
        const openAPIProperty = spec.getSchema(schema.properties[propertyName]);
        if (openAPIProperty.type === undefined) {
          return jsonSchema;
        }
        // eslint-disable-next-line no-param-reassign
        jsonSchema.properties[propertyName] = convertOpenAPISchemaToJSONSchema(
          openAPIProperty,
          spec
        );
        if (openAPIProperty.required && jsonSchema.required !== undefined) {
          jsonSchema.required.push(propertyName);
        }
        return jsonSchema;
      },
      {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: {},
      }
    );
  }
  if (schema.type === "array") {
    return {
      type: "array",
      items: convertOpenAPISchemaToJSONSchema(schema.items ?? {}, spec),
      minItems: schema.minItems,
      maxItems: schema.maxItems,
    } as JsonSchema7ArrayType;
  }
  return {
    type: schema.type ?? "string",
  } as JsonSchema7Type;
}