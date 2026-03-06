import assert from 'node:assert/strict';
import test from 'node:test';

import { HookRunner, HookFailureError } from './hooks.js';
import type { Logger } from '../logging/logger.js';

class CapturingLogger implements Logger {
  public readonly messages: Array<{ message: string; context?: Record<string, unknown> }> = [];
  info(message: string, context?: Record<string, unknown>): void {
    this.messages.push({ message, context });
  }
  warn(_m: string, _c?: Record<string, unknown>): void {}
  error(message: string, context?: Record<string, unknown>): void {
    this.messages.push({ message, context });
  }
}

function fakeExec(exitCode: number, stdout = '', stderr = '') {
  return async (_cmd: string, _args: string[], _opts: { cwd: string; timeout: number }) => ({
    stdout,
    stderr,
    exitCode,
  });
}

test('afterCreate succeeds when hook exits 0', async () => {
  const logger = new CapturingLogger();
  const runner = new HookRunner({
    hooks: { after_create: 'echo setup' },
    logger,
    exec: fakeExec(0, 'setup\n'),
  });

  const result = await runner.afterCreate('/tmp/ws');
  assert.equal(result.success, true);
  assert.equal(result.hook, 'after_create');
  assert.ok(logger.messages.some((m) => m.message === 'hook.success'));
});

test('afterCreate returns failure when hook exits non-zero', async () => {
  const logger = new CapturingLogger();
  const runner = new HookRunner({
    hooks: { after_create: 'exit 1' },
    logger,
    exec: fakeExec(1, '', 'bad thing'),
  });

  const result = await runner.afterCreate('/tmp/ws');
  assert.equal(result.success, false);
  assert.equal(result.exitCode, 1);
  assert.ok(logger.messages.some((m) => m.message === 'hook.failure'));
});

test('afterCreate detects timeout (exit code -1)', async () => {
  const logger = new CapturingLogger();
  const runner = new HookRunner({
    hooks: { after_create: 'sleep 999' },
    logger,
    exec: fakeExec(-1),
  });

  const result = await runner.afterCreate('/tmp/ws');
  assert.equal(result.success, false);
  assert.equal(result.timedOut, true);
  assert.ok(logger.messages.some((m) => m.message === 'hook.timeout'));
});

test('beforeRun returns failure on non-zero exit', async () => {
  const logger = new CapturingLogger();
  const runner = new HookRunner({
    hooks: { before_run: 'false' },
    logger,
    exec: fakeExec(2, '', 'precondition failed'),
  });

  const result = await runner.beforeRun('/tmp/ws');
  assert.equal(result.success, false);
});

test('afterRun returns result even on failure (non-fatal)', async () => {
  const logger = new CapturingLogger();
  const runner = new HookRunner({
    hooks: { after_run: 'cleanup' },
    logger,
    exec: fakeExec(1, '', 'cleanup error'),
  });

  const result = await runner.afterRun('/tmp/ws');
  assert.equal(result.success, false);
  // Should not throw — just returns the result
  assert.equal(result.hook, 'after_run');
});

test('beforeRemove returns result even on failure (non-fatal)', async () => {
  const logger = new CapturingLogger();
  const runner = new HookRunner({
    hooks: { before_remove: 'pre-cleanup' },
    logger,
    exec: fakeExec(1),
  });

  const result = await runner.beforeRemove('/tmp/ws');
  assert.equal(result.success, false);
  assert.equal(result.hook, 'before_remove');
});

test('skips hook when not configured', async () => {
  const logger = new CapturingLogger();
  const runner = new HookRunner({
    hooks: {},
    logger,
  });

  const result = await runner.afterCreate('/tmp/ws');
  assert.equal(result.success, true);
  assert.equal(logger.messages.length, 0);
});

test('passes cwd and timeout to exec', async () => {
  const logger = new CapturingLogger();
  const calls: Array<{ cmd: string; args: string[]; cwd: string; timeout: number }> = [];

  const runner = new HookRunner({
    hooks: { before_run: 'npm install' },
    timeoutMs: 30_000,
    logger,
    exec: async (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts.cwd, timeout: opts.timeout });
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  });

  await runner.beforeRun('/workspace/item-42');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.cmd, 'sh');
  assert.deepEqual(calls[0]!.args, ['-lc', 'npm install']);
  assert.equal(calls[0]!.cwd, '/workspace/item-42');
  assert.equal(calls[0]!.timeout, 30_000);
});

test('HookFailureError includes result details', () => {
  const err = new HookFailureError({
    hook: 'after_create',
    success: false,
    exitCode: 127,
  });
  assert.equal(err.name, 'HookFailureError');
  assert.match(err.message, /after_create/);
  assert.match(err.message, /127/);
  assert.equal(err.result.exitCode, 127);
});
