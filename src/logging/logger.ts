export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export class JsonConsoleLogger implements Logger {
  info(message: string, context: LogContext = {}): void {
    this.log("info", message, context);
  }

  warn(message: string, context: LogContext = {}): void {
    this.log("warn", message, context);
  }

  error(message: string, context: LogContext = {}): void {
    this.log("error", message, context);
  }

  private log(level: "info" | "warn" | "error", message: string, context: LogContext): void {
    const payload = {
      ts: new Date().toISOString(),
      level,
      message,
      ...context,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  }
}
