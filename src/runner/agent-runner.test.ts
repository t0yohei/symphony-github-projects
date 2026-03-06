import { strict as assert } from "node:assert";
import test from "node:test";
import type { NormalizedWorkItem } from "../model/work-item.js";
import { SubprocessAgentRunner } from "./agent-runner.js";

const fixtureItem: NormalizedWorkItem = {
  id: "item-10",
  number: 10,
  title: "Implement agent runner",
  body: "Build a subprocess-backed runner",
  state: "in_progress",
  labels: ["enhancement"],
  assignees: ["kouka"],
  url: "https://example.com/issues/10",
  updatedAt: "2026-03-06T00:00:00.000Z",
};

test("SubprocessAgentRunner.buildPrompt embeds template and work item details", () => {
  const runner = new SubprocessAgentRunner();
  const prompt = runner.buildPrompt(fixtureItem, {
    system: "You are a coding agent.",
    task: "Solve the issue in scope.",
  });

  assert.match(prompt, /You are a coding agent\./);
  assert.match(prompt, /Solve the issue in scope\./);
  assert.match(prompt, /Issue Number: 10/);
  assert.match(prompt, /Title: Implement agent runner/);
});

test("SubprocessAgentRunner.run streams events and captures metrics", async () => {
  const runner = new SubprocessAgentRunner();
  const handle = runner.run({
    item: fixtureItem,
    workspaceDir: process.cwd(),
    promptTemplate: {
      system: "System",
      task: "Task",
    },
    command: {
      command: process.execPath,
      args: [
        "-e",
        [
          'console.log("hello from agent")',
          'console.log("TOKENS=42")',
        ].join(";"),
      ],
    },
  });

  const events = (async () => {
    const acc: string[] = [];
    for await (const event of handle.events) {
      acc.push(event.type);
    }
    return acc;
  })();

  const result = await handle.result;
  const emitted = await events;

  assert.equal(result.exitCode, 0);
  assert.equal(result.metrics.tokenCount, 42);
  assert.ok(result.metrics.runtimeMs >= 0);
  assert.ok(emitted.includes("started"));
  assert.ok(emitted.includes("stdout"));
  assert.ok(emitted.includes("metrics"));
  assert.ok(emitted.includes("completed"));
});

test("SubprocessAgentRunner.run surfaces non-zero exits with actionable details", async () => {
  const runner = new SubprocessAgentRunner();
  const handle = runner.run({
    item: fixtureItem,
    workspaceDir: process.cwd(),
    promptTemplate: {
      system: "System",
      task: "Task",
    },
    command: {
      command: process.execPath,
      args: ["-e", 'console.error("boom"); process.exit(2);'],
    },
  });

  await assert.rejects(handle.result, (error: Error & { details?: { exitCode?: number; stderrTail?: string } }) => {
    assert.equal(error.name, "AgentRunError");
    assert.equal(error.details?.exitCode, 2);
    assert.match(error.details?.stderrTail ?? "", /boom/);
    return true;
  });
});

test("SubprocessAgentRunner supports cancellation", async () => {
  const runner = new SubprocessAgentRunner();
  const handle = runner.run({
    item: fixtureItem,
    workspaceDir: process.cwd(),
    promptTemplate: {
      system: "System",
      task: "Task",
    },
    command: {
      command: process.execPath,
      args: ["-e", 'setInterval(() => console.log("running"), 100);'],
    },
  });

  handle.cancel();

  await assert.rejects(handle.result, (error: Error & { details?: { signal?: NodeJS.Signals | null } }) => {
    assert.equal(error.name, "AgentRunError");
    assert.ok(error.details?.signal === "SIGINT" || error.details?.signal === "SIGTERM");
    return true;
  });
});
