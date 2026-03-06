import test from "node:test";
import assert from "node:assert/strict";

import { normalizeState, sanitizeWorkspaceKey } from "./work-item.js";

test("normalizeState trims + lowercases and maps aliases", () => {
  assert.equal(normalizeState("  In Progress  "), "in_progress");
  assert.equal(normalizeState("CLOSED"), "done");
  assert.equal(normalizeState(" backlog "), "todo");
});

test("normalizeState falls back to todo for unknown values", () => {
  assert.equal(normalizeState("needs-triage"), "todo");
  assert.equal(normalizeState(undefined), "todo");
});

test("sanitizeWorkspaceKey normalizes separators", () => {
  assert.equal(sanitizeWorkspaceKey("  Team A / Sprint 1  "), "team-a-sprint-1");
  assert.equal(sanitizeWorkspaceKey("Feature:Auth#Core"), "feature-auth-core");
});
