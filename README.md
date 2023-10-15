# NextJS OpenAI Plugins as Function Calls
> WORK IN PROGRESS, MAY NEVER BE COMPLETED

OpenAI GPT is well setup to call functions, and though public ChatGPT supports plugins, it's not clear how the two of them are related.

This is an attempt to load OpenAI plugins and to offer them as callable functions to GPT function calling.

I'm using [NextJS's experimental OpenAI functions SDK](https://sdk.vercel.ai/docs/guides/providers/openai-functions)

## First attempt - DIY
[Commit](https://github.com/leongj/nextjs-openai/tree/4593b8e2d83622d865cde2ec24d0707b00f4d4e7)
### Concept
Load all plugins and find all endpoint+method in the APIs and load those all into a OpenAI functions object for the LLM.
### Process
  1. Load and validate plugin files from disk (/plugins/<plugin name>) [plugins.ts](/lib/plugins.ts)
  2. Parse all endpoint+method out of the APIs and load them into a Functions object [functions.ts](/lib/functions.ts)
  3. When the LLM calls a function, figure out which plugin it belonged to (because the API Auth info is in there)
### Learning
- Hard to handle all OpenAPI spec valid schemas
- Had to reverse map function to plugin, attempted to use "pluginname_functionname"
- All too hard

## Second attempt - DIY + copy Langchain
To make it easier, I tried copying [code](https://github.com/langchain-ai/langchainjs/blob/1615dbe4aad5ead0bc78a6833f1d12e08a565b27/langchain/src/chains/openai_functions/openapi.ts) from Langchain's [OpenAI Functions : OpenAPI calls chain](https://js.langchain.com/docs/modules/chains/additional/openai_functions/openapi)
- This helped somewhat with the initial parsing of the file and returning functions
- But then you still have other stuff to deal with (different methods, params vs. req objects, auth) and these were tightly integrated with the Langchain chain model
- So I'm giving up on this too

## Third attempt - Hybrid
### Concept
Function definitions consume tokens and loading all APIs for all Plugins is going to be unscalable.  

So:  
Load Plugins as "Functions" and allow the model to call a plugin at the top level. This should be easy to code as the ai-plugin.json spec is super simple.
Then use the Langchain [OpenAI Functions : OpenAPI calls chain](https://js.langchain.com/docs/modules/chains/additional/openai_functions/openapi) chain to actually call the required API using functions.
Ideally, we should pass the full message history to the chain call so that it can re-use any contextual information from the conversation.


---  

# Default NextJS app bootstrap doc below

This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
