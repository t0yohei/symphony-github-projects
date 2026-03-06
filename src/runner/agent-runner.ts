import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { createInterface } from "node:readline";
import type { NormalizedWorkItem } from "../model/work-item.js";

export interface RunnerPromptTemplate {
  system: string;
  task: string;
}

export interface AgentRunnerCommand {
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
}

export interface AgentRunRequest {
  item: NormalizedWorkItem;
  workspaceDir: string;
  promptTemplate: RunnerPromptTemplate;
  command: AgentRunnerCommand;
}

export interface AgentRunMetrics {
  runtimeMs: number;
  tokenCount?: number;
}

export interface AgentRunResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  metrics: AgentRunMetrics;
}

export type AgentRunnerEvent =
  | { type: "started"; pid: number; prompt: string }
  | { type: "stdout"; line: string }
  | { type: "stderr"; line: string }
  | { type: "metrics"; tokenCount: number }
  | { type: "terminated"; reason: "cancel" | "terminate" }
  | { type: "completed"; result: AgentRunResult }
  | { type: "failed"; error: AgentRunError };

export interface AgentRunHandle {
  events: AsyncIterable<AgentRunnerEvent>;
  result: Promise<AgentRunResult>;
  cancel(): void;
  terminate(): void;
}

export interface AgentRunner {
  buildPrompt(item: NormalizedWorkItem, promptTemplate: RunnerPromptTemplate): string;
  run(request: AgentRunRequest): AgentRunHandle;
}

export class AgentRunError extends Error {
  constructor(
    message: string,
    readonly details: {
      code?: string;
      command: string;
      args: string[];
      workspaceDir: string;
      stderrTail?: string;
      exitCode?: number;
      signal?: NodeJS.Signals | null;
    },
  ) {
    super(message);
    this.name = "AgentRunError";
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ done: false, value });
      return;
    }
    this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.({ done: true, value: undefined as never });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          return Promise.resolve({ done: false, value: this.values.shift() as T });
        }
        if (this.closed) {
          return Promise.resolve({ done: true, value: undefined as never });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

export class SubprocessAgentRunner implements AgentRunner {
  buildPrompt(item: NormalizedWorkItem, promptTemplate: RunnerPromptTemplate): string {
    const labels = item.labels.length > 0 ? item.labels.join(", ") : "none";
    const assignees = item.assignees.length > 0 ? item.assignees.join(", ") : "none";
    const details = [
      `Item ID: ${item.id}`,
      `Issue Number: ${item.number ?? "n/a"}`,
      `Title: ${item.title}`,
      `State: ${item.state}`,
      `Labels: ${labels}`,
      `Assignees: ${assignees}`,
      `Updated At: ${item.updatedAt}`,
      `URL: ${item.url ?? "n/a"}`,
      "",
      "Body:",
      item.body ?? "(empty)",
    ].join("\n");

    return [promptTemplate.system.trim(), "", promptTemplate.task.trim(), "", details].join("\n");
  }

  run(request: AgentRunRequest): AgentRunHandle {
    const prompt = this.buildPrompt(request.item, request.promptTemplate);
    const queue = new AsyncEventQueue<AgentRunnerEvent>();
    const startAt = Date.now();
    const args = [...(request.command.args ?? []), prompt];
    let stderrTail = "";
    let tokenCount: number | undefined;

    const child = spawn(request.command.command, args, {
      cwd: request.workspaceDir,
      env: {
        ...process.env,
        ...request.command.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (!child.pid) {
      const error = new AgentRunError("Failed to spawn agent process", {
        command: request.command.command,
        args,
        workspaceDir: request.workspaceDir,
      });
      queue.push({ type: "failed", error });
      queue.close();
      return {
        events: queue,
        result: Promise.reject(error),
        cancel: () => undefined,
        terminate: () => undefined,
      };
    }

    queue.push({ type: "started", pid: child.pid, prompt });

    this.streamLines(child, "stdout", (line) => {
      queue.push({ type: "stdout", line });
      const parsed = this.parseMetricLine(line);
      if (parsed !== undefined) {
        tokenCount = parsed;
        queue.push({ type: "metrics", tokenCount: parsed });
      }
    });

    this.streamLines(child, "stderr", (line) => {
      stderrTail = [stderrTail, line].filter(Boolean).join("\n").slice(-2000);
      queue.push({ type: "stderr", line });
    });

    const finalize = (result: AgentRunResult): AgentRunResult => {
      queue.push({ type: "completed", result });
      queue.close();
      return result;
    };

    const result = new Promise<AgentRunResult>((resolve, reject) => {
      child.once("error", (err) => {
        const error = new AgentRunError("Agent process errored", {
          code: (err as NodeJS.ErrnoException).code,
          command: request.command.command,
          args,
          workspaceDir: request.workspaceDir,
          stderrTail,
        });
        queue.push({ type: "failed", error });
        queue.close();
        reject(error);
      });

      child.once("close", (exitCode, signal) => {
        const runtimeMs = Date.now() - startAt;
        const settled = {
          exitCode: exitCode ?? 1,
          signal,
          metrics: {
            runtimeMs,
            tokenCount,
          },
        } satisfies AgentRunResult;

        if ((exitCode ?? 1) !== 0) {
          const error = new AgentRunError("Agent process exited with non-zero status", {
            command: request.command.command,
            args,
            workspaceDir: request.workspaceDir,
            stderrTail,
            exitCode: settled.exitCode,
            signal,
          });
          queue.push({ type: "failed", error });
          queue.close();
          reject(error);
          return;
        }

        resolve(finalize(settled));
      });
    });

    return {
      events: queue,
      result,
      cancel: () => this.kill(child, "SIGINT", queue, "cancel"),
      terminate: () => this.kill(child, "SIGTERM", queue, "terminate"),
    };
  }

  private streamLines(
    child: ChildProcessByStdio<null, Readable, Readable>,
    stream: "stdout" | "stderr",
    onLine: (line: string) => void,
  ): void {
    const rl = createInterface({ input: child[stream] });
    rl.on("line", onLine);
    child.once("close", () => {
      rl.close();
    });
  }

  private kill(
    child: ChildProcessByStdio<null, Readable, Readable>,
    signal: NodeJS.Signals,
    queue: AsyncEventQueue<AgentRunnerEvent>,
    reason: "cancel" | "terminate",
  ): void {
    if (child.killed) return;
    child.kill(signal);
    queue.push({ type: "terminated", reason });
  }

  private parseMetricLine(line: string): number | undefined {
    const prefixed = line.match(/^TOKENS=(\d+)$/);
    if (prefixed) {
      return Number(prefixed[1]);
    }

    try {
      const parsed = JSON.parse(line) as { tokenCount?: unknown; tokens?: unknown };
      const candidate = parsed.tokenCount ?? parsed.tokens;
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return candidate;
      }
    } catch {
      // Not JSON line; ignore.
    }

    return undefined;
  }
}
