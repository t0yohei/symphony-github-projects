import { execFile } from 'node:child_process';
import type { Logger } from '../logging/logger.js';

export interface WorkspaceHooks {
  after_create?: string;
  before_run?: string;
  after_run?: string;
  before_remove?: string;
}

export interface HookRunnerOptions {
  hooks: WorkspaceHooks;
  timeoutMs?: number;
  logger: Logger;
  exec?: ExecFn;
}

export interface HookResult {
  hook: string;
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  error?: string;
}

type ExecFn = (
  command: string,
  args: string[],
  options: { cwd: string; timeout: number },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

const DEFAULT_TIMEOUT_MS = 60_000;

function defaultExec(
  command: string,
  args: string[],
  options: { cwd: string; timeout: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = execFile(command, args, {
      cwd: options.cwd,
      timeout: options.timeout,
      shell: false,
      maxBuffer: 1024 * 1024,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    proc.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    proc.on('error', (err) => {
      if ('killed' in proc && proc.killed) {
        resolve({ stdout, stderr, exitCode: -1 });
      } else {
        reject(err);
      }
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

export class HookRunner {
  private readonly hooks: WorkspaceHooks;
  private readonly timeoutMs: number;
  private readonly logger: Logger;
  private readonly execFn: ExecFn;

  constructor(options: HookRunnerOptions) {
    this.hooks = options.hooks;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = options.logger;
    this.execFn = options.exec ?? defaultExec;
  }

  /**
   * Run after_create hook. Failure is fatal — caller should clean up the workspace.
   */
  async afterCreate(cwd: string): Promise<HookResult> {
    return this.runHook('after_create', cwd);
  }

  /**
   * Run before_run hook. Failure is fatal to the current run attempt.
   */
  async beforeRun(cwd: string): Promise<HookResult> {
    return this.runHook('before_run', cwd);
  }

  /**
   * Run after_run hook. Failure is logged and ignored.
   */
  async afterRun(cwd: string): Promise<HookResult> {
    return this.runHookSafe('after_run', cwd);
  }

  /**
   * Run before_remove hook. Failure is logged and ignored; cleanup proceeds.
   */
  async beforeRemove(cwd: string): Promise<HookResult> {
    return this.runHookSafe('before_remove', cwd);
  }

  private async runHook(hookName: keyof WorkspaceHooks, cwd: string): Promise<HookResult> {
    const command = this.hooks[hookName];
    if (!command) {
      return { hook: hookName, success: true };
    }

    this.logger.info(`hook.start`, { hook: hookName, command, cwd });

    try {
      const result = await this.execFn('sh', ['-lc', command], {
        cwd,
        timeout: this.timeoutMs,
      });

      const timedOut = result.exitCode === -1;
      const success = result.exitCode === 0;

      if (success) {
        this.logger.info(`hook.success`, { hook: hookName });
      } else if (timedOut) {
        this.logger.error(`hook.timeout`, { hook: hookName, timeoutMs: this.timeoutMs });
      } else {
        this.logger.error(`hook.failure`, {
          hook: hookName,
          exitCode: result.exitCode,
          stderr: result.stderr.slice(0, 500),
        });
      }

      return {
        hook: hookName,
        success,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`hook.error`, { hook: hookName, error: message });
      return {
        hook: hookName,
        success: false,
        error: message,
      };
    }
  }

  private async runHookSafe(hookName: keyof WorkspaceHooks, cwd: string): Promise<HookResult> {
    const result = await this.runHook(hookName, cwd);
    // Always return the result but don't throw — caller decides severity
    return result;
  }
}

export class HookFailureError extends Error {
  constructor(public readonly result: HookResult) {
    super(`Hook "${result.hook}" failed: ${result.error ?? `exit code ${result.exitCode}`}`);
    this.name = 'HookFailureError';
  }
}
