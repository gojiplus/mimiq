/**
 * Centralized logging utility.
 * Uses console for browser compatibility.
 * Node.js code can import pino directly if needed.
 */

interface Logger {
  debug: (obj: object | string, msg?: string) => void;
  info: (obj: object | string, msg?: string) => void;
  warn: (obj: object | string, msg?: string) => void;
  error: (obj: object | string, msg?: string) => void;
  child: (bindings: object) => Logger;
}

function createConsoleLogger(component?: string): Logger {
  const prefix = component ? `[${component}]` : "";

  const shouldLog = (level: string): boolean => {
    const configLevel =
      (typeof process !== "undefined" && process.env?.MIMIQ_LOG_LEVEL) || "info";
    const levels = ["debug", "info", "warn", "error"];
    return levels.indexOf(level) >= levels.indexOf(configLevel);
  };

  const log = (level: string, obj: object | string, msg?: string) => {
    if (!shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const levelUpper = level.toUpperCase();

    if (typeof obj === "string") {
      console.log(`${timestamp} ${levelUpper} ${prefix} ${obj}`);
    } else if (msg) {
      console.log(`${timestamp} ${levelUpper} ${prefix} ${msg}`, obj);
    } else {
      console.log(`${timestamp} ${levelUpper} ${prefix}`, obj);
    }
  };

  return {
    debug: (obj, msg) => log("debug", obj, msg),
    info: (obj, msg) => log("info", obj, msg),
    warn: (obj, msg) => log("warn", obj, msg),
    error: (obj, msg) => log("error", obj, msg),
    child: (bindings) =>
      createConsoleLogger(
        (bindings as { component?: string }).component || component
      ),
  };
}

const baseLogger = createConsoleLogger();

export function createLogger(component: string): Logger {
  return createConsoleLogger(component);
}

export { baseLogger as logger };
