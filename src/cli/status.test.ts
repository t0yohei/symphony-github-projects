import test from "node:test";
import assert from "node:assert/strict";

import { summarizeStructuredLogs } from "./status.js";

test("summarizeStructuredLogs aggregates structured events and correlation", () => {
  const lines = [
    '{"event":"poll.started","ts":"2026-01-01T00:00:00.000Z"}',
    '{"event":"dispatch.started","item_id":"item-1","session_id":"session-1"}',
    '{"event":"dispatch.completed","item_id":"item-1","session_id":"session-1"}',
    '{"event":"unknown"}',
    'not-json',
  ];

  const summary = summarizeStructuredLogs(lines);

  assert.equal(summary.totalEvents, 4);
  assert.equal(summary.eventCounts["poll.started"], 1);
  assert.equal(summary.eventCounts["dispatch.started"], 1);
  assert.equal(summary.eventCounts["dispatch.completed"], 1);
  assert.equal(summary.latestCorrelationByItemId["item-1"], "session-1");
});
