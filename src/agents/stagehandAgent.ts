/**
 * StagehandAgent: BrowserAgent implementation using @browserbasehq/stagehand.
 * Requires Stagehand v3+ installed as a peer dependency.
 */

import type { BrowserAgent, BrowserAgentOptions } from "./browserAgent";
import type { BrowserObservation, BrowserActionResult } from "../types";
import { createLogger } from "../utils/nodeLogger";

const log = createLogger("StagehandAgent");

interface StagehandInstance {
  init(): Promise<void>;
  act(instruction: string): Promise<unknown>;
  extract(instruction: string, options?: { schema?: unknown }): Promise<unknown>;
  observe(options?: { instruction?: string }): Promise<Array<{ selector: string; description: string }>>;
  context: {
    pages(): Array<{
      url(): string;
      title(): Promise<string>;
      content(): Promise<string>;
      screenshot(options?: { fullPage?: boolean }): Promise<Buffer>;
      goto(url: string): Promise<void>;
      evaluate<T>(fn: () => T): Promise<T>;
    }>;
  };
  close(): Promise<void>;
}

interface StagehandConstructor {
  new (options: {
    env?: "LOCAL" | "BROWSERBASE";
    modelName?: string;
    modelClientOptions?: Record<string, unknown>;
    headless?: boolean;
    timeout?: number;
    verbose?: number;
    debugDom?: boolean;
    enableCaching?: boolean;
  }): StagehandInstance;
}

async function loadStagehand(): Promise<StagehandConstructor> {
  try {
    const module = await import("@browserbasehq/stagehand");
    return module.Stagehand as unknown as StagehandConstructor;
  } catch {
    throw new Error(
      "Stagehand not installed. Install it with: npm install @browserbasehq/stagehand"
    );
  }
}

class StagehandAgentImpl implements BrowserAgent {
  private stagehand: StagehandInstance | null = null;
  private options: BrowserAgentOptions;

  constructor(options: BrowserAgentOptions = {}) {
    this.options = options;
  }

  async start(url: string): Promise<void> {
    const Stagehand = await loadStagehand();

    const modelName = this.options.model || process.env.STAGEHAND_MODEL || "anthropic/claude-sonnet-4-20250514";
    const headless = this.options.headless ?? (process.env.STAGEHAND_HEADLESS !== "false");

    log.info({ url, model: modelName, headless }, "Starting Stagehand agent");

    this.stagehand = new Stagehand({
      env: "LOCAL",
      modelName,
      headless,
      verbose: 0,
      enableCaching: true,
    });

    await this.stagehand.init();
    const page = this.stagehand.context.pages()[0];
    await page.goto(url);

    log.debug({ url }, "Navigated to URL");
  }

  async act(instruction: string): Promise<BrowserActionResult> {
    if (!this.stagehand) {
      throw new Error("Agent not started. Call start() first.");
    }

    log.debug({ instruction }, "Executing action");

    try {
      const result = await this.stagehand.act(instruction);
      log.debug({ instruction, result }, "Action completed");

      return {
        success: true,
        text: typeof result === "string" ? result : JSON.stringify(result),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error({ instruction, error: errorMsg }, "Action failed");

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  async extract(query: string): Promise<string> {
    if (!this.stagehand) {
      throw new Error("Agent not started. Call start() first.");
    }

    log.debug({ query }, "Extracting data");

    const result = await this.stagehand.extract(query);
    const text = typeof result === "string" ? result : JSON.stringify(result);

    log.debug({ query, resultLength: text.length }, "Extraction completed");

    return text;
  }

  async observe(): Promise<BrowserObservation> {
    if (!this.stagehand) {
      throw new Error("Agent not started. Call start() first.");
    }

    const page = this.stagehand.context.pages()[0];
    const url = page.url();
    const title = await page.title();

    log.debug({ url, title }, "Observing page");

    let visibleText = "";
    let chatMessages: Array<{ role: string; content: string }> = [];

    try {
      const extracted = await this.stagehand.extract(
        "Extract all visible text content from the page, especially any chat messages or conversation"
      );
      visibleText = typeof extracted === "string" ? extracted : JSON.stringify(extracted);
    } catch (error) {
      log.debug({ error }, "Stagehand extract failed, using DOM fallback");
      try {
        visibleText = await page.evaluate(() => {
          return document.body?.innerText || "";
        });
      } catch (evalError) {
        log.warn({ evalError }, "DOM fallback also failed");
      }
    }

    try {
      const messages = await this.stagehand.extract(
        "Extract all chat messages as an array with role (user/assistant) and content fields. Return empty array if no chat."
      ) as Array<{ role: string; content: string }>;

      if (Array.isArray(messages)) {
        chatMessages = messages;
      }
    } catch (error) {
      log.debug({ error }, "Chat extraction failed, trying DOM fallback");
      try {
        chatMessages = await page.evaluate(() => {
          const msgs: Array<{ role: string; content: string }> = [];
          const userMsgs = document.querySelectorAll("[data-role='user'], .user-message, .message-user");
          const assistantMsgs = document.querySelectorAll("[data-role='assistant'], .assistant-message, .message-assistant, .bot-message");
          userMsgs.forEach((el) => msgs.push({ role: "user", content: el.textContent || "" }));
          assistantMsgs.forEach((el) => msgs.push({ role: "assistant", content: el.textContent || "" }));
          return msgs;
        });
      } catch {
        log.debug("Chat DOM fallback failed");
      }
    }

    const stateMarkers: string[] = [];
    try {
      const observations = await this.stagehand.observe({ instruction: "What interactive elements are visible?" });
      if (observations.length > 0) {
        stateMarkers.push("interactive_elements_present");
      }
    } catch {
      log.debug("Observe call not supported or failed");
    }

    return {
      url,
      title,
      visibleText,
      chatMessages,
      stateMarkers,
    };
  }

  async screenshot(): Promise<Buffer> {
    if (!this.stagehand) {
      throw new Error("Agent not started. Call start() first.");
    }

    const page = this.stagehand.context.pages()[0];
    return page.screenshot({ fullPage: false });
  }

  async stop(): Promise<void> {
    if (this.stagehand) {
      log.debug("Stopping Stagehand agent");
      await this.stagehand.close();
      this.stagehand = null;
    }
  }
}

export async function createStagehandAgent(
  options?: BrowserAgentOptions
): Promise<BrowserAgent> {
  return new StagehandAgentImpl(options);
}
