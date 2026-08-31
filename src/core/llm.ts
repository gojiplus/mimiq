/**
 * Private model-gateway client for simulator and judge policies.
 * Use Ollama directly or route any provider through a LiteLLM gateway.
 */

import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export interface LLMConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  baseURL?: string;
  apiKey?: string;
  reasoningEffort?: string | null;
}

export interface LLMResult {
  text: string;
}

export const DEFAULT_LLM_MODEL = "qwen3:8b";
export const DEFAULT_LLM_BASE_URL = "http://127.0.0.1:11434/v1";
export const DEFAULT_LLM_REASONING_EFFORT = "none";

function resolveLLMConfig(config: LLMConfig) {
  return {
    model: config.model ?? process.env.MIMIQ_MODEL ?? DEFAULT_LLM_MODEL,
    baseURL: config.baseURL ?? process.env.MIMIQ_LLM_BASE_URL ?? DEFAULT_LLM_BASE_URL,
    apiKey: config.apiKey ?? process.env.MIMIQ_LLM_API_KEY ?? "ollama",
    reasoningEffort: config.reasoningEffort === null
      ? undefined
      : config.reasoningEffort
        ?? process.env.MIMIQ_LLM_REASONING_EFFORT
        ?? DEFAULT_LLM_REASONING_EFFORT,
  };
}

function languageModel(config: LLMConfig) {
  const resolved = resolveLLMConfig(config);
  const provider = createOpenAICompatible({
    name: "mimiq",
    baseURL: resolved.baseURL,
    apiKey: resolved.apiKey,
  });
  return provider.chatModel(resolved.model);
}

function modelGatewayOptions(config: ReturnType<typeof resolveLLMConfig>) {
  return config.reasoningEffort === undefined
    ? undefined
    : { mimiq: { reasoningEffort: config.reasoningEffort } };
}

export async function complete(
  prompt: string,
  config: LLMConfig = {},
): Promise<string> {
  const resolved = resolveLLMConfig(config);
  const model = languageModel(resolved);

  const { text } = await generateText({
    model,
    prompt,
    maxOutputTokens: config.maxTokens,
    temperature: config.temperature,
    providerOptions: modelGatewayOptions(resolved),
  });

  return text;
}

export async function completeWithImage(
  prompt: string,
  imageBase64: string,
  config: LLMConfig = {},
): Promise<string> {
  const resolved = resolveLLMConfig(config);
  const model = languageModel(resolved);

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
    providerOptions: modelGatewayOptions(resolved),
  });

  return text;
}

export async function completeWithHtmlAndImage(
  prompt: string,
  html: string,
  imageBase64: string,
  config: LLMConfig = {},
): Promise<string> {
  const resolved = resolveLLMConfig(config);
  const model = languageModel(resolved);

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
    providerOptions: modelGatewayOptions(resolved),
  });

  return text;
}
