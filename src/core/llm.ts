/**
 * Shared LLM client using Vercel AI SDK for multi-provider support.
 * Supports Google, OpenAI, Anthropic, and local OpenAI-compatible providers.
 */

import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";

export interface LLMConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  baseURL?: string;
  apiKey?: string;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface LLMResult {
  text: string;
}

const reasoningEfforts = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

function localModel(modelName: string, config: LLMConfig) {
  const baseURL = config.baseURL ?? process.env.LLM_BASE_URL;

  if (!baseURL) {
    throw new Error(
      `Local model "${modelName}" requires baseURL or LLM_BASE_URL.`,
    );
  }

  const provider = createOpenAI({
    baseURL,
    apiKey: config.apiKey ?? process.env.LLM_API_KEY ?? "ollama",
    name: "local",
  });

  return provider.chat(modelName);
}

function parseModel(modelString: string, config: LLMConfig) {
  const [provider, ...rest] = modelString.split("/");
  const modelName = rest.join("/");

  switch (provider) {
    case "google":
      return google(modelName);
    case "openai":
      return openai(modelName);
    case "anthropic":
      return anthropic(modelName);
    case "local":
      return localModel(modelName, config);
    default:
      return google(modelString);
  }
}

function localProviderOptions(modelString: string, config: LLMConfig) {
  if (!modelString.startsWith("local/")) {
    return undefined;
  }

  const reasoningEffort =
    config.reasoningEffort ?? process.env.LLM_REASONING_EFFORT ?? "none";

  if (!reasoningEfforts.includes(reasoningEffort as typeof reasoningEfforts[number])) {
    throw new Error(
      `Invalid local reasoning effort "${reasoningEffort}". Expected one of: ${reasoningEfforts.join(", ")}.`,
    );
  }

  return {
    openai: {
      reasoningEffort,
    },
  };
}

export async function complete(
  prompt: string,
  config: LLMConfig = {},
): Promise<string> {
  const modelString =
    config.model || process.env.LLM_MODEL || "google/gemini-2.0-flash";
  const model = parseModel(modelString, config);

  const { text } = await generateText({
    model,
    prompt,
    maxOutputTokens: config.maxTokens,
    temperature: config.temperature,
    providerOptions: localProviderOptions(modelString, config),
  });

  return text;
}

export async function completeWithImage(
  prompt: string,
  imageBase64: string,
  config: LLMConfig = {},
): Promise<string> {
  const modelString =
    config.model || process.env.LLM_MODEL || "google/gemini-2.0-flash";
  const model = parseModel(modelString, config);

  const { text } = await generateText({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", image: imageBase64 },
        ],
      },
    ],
    maxOutputTokens: config.maxTokens,
    temperature: config.temperature,
    providerOptions: localProviderOptions(modelString, config),
  });

  return text;
}

export async function completeWithHtmlAndImage(
  prompt: string,
  html: string,
  imageBase64: string,
  config: LLMConfig = {},
): Promise<string> {
  const modelString =
    config.model || process.env.LLM_MODEL || "google/gemini-2.0-flash";
  const model = parseModel(modelString, config);

  const { text } = await generateText({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "text", text: `HTML:\n${html}` },
          { type: "image", image: imageBase64 },
        ],
      },
    ],
    maxOutputTokens: config.maxTokens,
    temperature: config.temperature,
    providerOptions: localProviderOptions(modelString, config),
  });

  return text;
}
