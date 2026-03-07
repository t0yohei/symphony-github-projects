#!/usr/bin/env node
import { JsonConsoleLogger } from './logging/logger.js';
import { bootstrapFromWorkflow } from './bootstrap.js';
import { PollingRuntime } from './orchestrator/runtime.js';
import { FileWorkflowLoader } from './workflow/contract.js';
import { WorkflowHotReloader } from './workflow/hot-reload.js';
import type { LoadedWorkflowContract } from './workflow/contract.js';

interface ServiceConfig {
  workflowPath: string;
}

const DEFAULT_WORKFLOW_PATH = 'WORKFLOW.md';

function parseArgs(argv: string[]): ServiceConfig {
  let workflowPath = process.env.WORKFLOW_PATH ?? DEFAULT_WORKFLOW_PATH;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if ((arg === '--workflow' || arg === '-w') && i + 1 < argv.length) {
      workflowPath = argv[i + 1];
      i += 1;
    }
  }

  return { workflowPath };
}

function printUsage(): void {
  // eslint-disable-next-line no-console
  console.log(`Usage: node dist/cli.js [--workflow path | -w path]\n` +
    'Starts Symphony-GitHub-Projects runtime loop using the specified WORKFLOW.md.');
}

async function runService(config: ServiceConfig): Promise<void> {
  const logger = new JsonConsoleLogger();

  const workflowPath = config.workflowPath;
  const workflowLoader = new FileWorkflowLoader();

  const bootstrapResult = await bootstrapFromWorkflow(workflowPath, {
    workflowLoader,
    logger,
  });

  const runtime = bootstrapResult.runtime as PollingRuntime;
  let currentPollIntervalMs = bootstrapResult.workflow.polling.intervalMs;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlightTick = false;
  let stopping = false;

  const tick = async (): Promise<void> => {
    if (stopping) return;
    if (inFlightTick) {
      logger.warn('runtime.tick.skip_in_progress');
      return;
    }

    inFlightTick = true;
    try {
      await runtime.tick();
    } catch (error) {
      logger.error('runtime.tick.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      inFlightTick = false;
      if (!stopping) {
        scheduleNextTick(currentPollIntervalMs);
      }
    }
  };

  const scheduleNextTick = (delayMs: number): void => {
    if (stopping) return;

    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    timer = setTimeout(() => {
      void tick();
    }, Math.max(0, delayMs));
  };

  const applyWorkflow = (contract: LoadedWorkflowContract): void => {
    try {
      runtime.applyWorkflow(contract);
      currentPollIntervalMs = Math.max(1_000, contract.polling.intervalMs);
      logger.info('runtime.config.reloaded', {
        pollIntervalMs: currentPollIntervalMs,
        maxConcurrency: contract.polling.maxConcurrency,
        maxConcurrencyRuntime: contract.runtime.maxConcurrency,
      });
      if (!stopping) {
        scheduleNextTick(currentPollIntervalMs);
      }
    } catch (error) {
      logger.error('runtime.config.reload_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const reloader = new WorkflowHotReloader({
    workflowPath,
    loader: workflowLoader,
    logger,
    onReload: applyWorkflow,
  });

  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;

    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    reloader.stop();
    logger.info('service.shutdown_requested');
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  reloader.start(bootstrapResult.workflow);
  logger.info('service.started', {
    workflowPath,
    pollIntervalMs: currentPollIntervalMs,
    maxConcurrency: bootstrapResult.workflow.polling.maxConcurrency,
    runtimeKind: bootstrapResult.workflow.tracker.kind,
  });

  scheduleNextTick(0);
}

const config = parseArgs(process.argv.slice(2));
void runService(config).catch((error) => {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      message: 'service.bootstrap_failed',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
