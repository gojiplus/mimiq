/**
 * Shared LLM client using Vercel AI SDK for multi-provider support.
 * Supports Google, OpenAI, and Anthropic providers.
 */

import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";

export interface LLMConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResult {
  text: string;
}

function parseModel(modelString: string) {
  const [provider, ...rest] = modelString.split("/");
  const modelName = rest.join("/");

  switch (provider) {
    case "google":
      return google(modelName);
    case "openai":
      return openai(modelName);
    case "anthropic":
      return anthropic(modelName);
    default:
      return google(modelString);
  }
}

export async function complete(
  prompt: string,
  config: LLMConfig = {},
): Promise<string> {
  const modelString =
    config.model || process.env.LLM_MODEL || "google/gemini-2.0-flash";
  const model = parseModel(modelString);

  const { text } = await generateText({
    model,
    prompt,
    maxOutputTokens: config.maxTokens,
    temperature: config.temperature,
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
  const model = parseModel(modelString);

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
  const model = parseModel(modelString);

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
  });

  return text;
}
