/**
 * Node.js-only logger using pino.
 * Use this in Node.js-only code (CLI, agentRunner, etc.)
 */

import pino from "pino";

const level = process.env.MIMIQ_LOG_LEVEL || "info";

const baseLogger = pino({
  level,
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

export function createLogger(component: string) {
  return baseLogger.child({ component });
}

export { baseLogger as logger };
