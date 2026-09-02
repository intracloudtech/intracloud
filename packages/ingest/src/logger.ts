/** Minimal structured logger. One line per event, greppable, CI-friendly. */

type Level = "info" | "warn" | "error";

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** count of warnings emitted — surfaced in the run summary. */
  warnings: number;
}

function fmt(level: Level, msg: string, fields?: Record<string, unknown>): string {
  const parts = [`[${level}]`, msg];
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      parts.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
  }
  return parts.join(" ");
}

export function createLogger(sink: (line: string) => void = console.log): Logger {
  let warnings = 0;
  return {
    info: (m, f) => sink(fmt("info", m, f)),
    warn: (m, f) => {
      warnings++;
      sink(fmt("warn", m, f));
    },
    error: (m, f) => sink(fmt("error", m, f)),
    get warnings() {
      return warnings;
    },
  };
}
