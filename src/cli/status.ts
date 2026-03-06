import { readFileSync } from "node:fs";

interface LogEvent {
  event?: string;
  ts?: string;
  level?: string;
  [key: string]: unknown;
}

export interface StatusSummary {
  totalEvents: number;
  eventCounts: Record<string, number>;
  latestCorrelationByItemId: Record<string, string>;
}

export function summarizeStructuredLogs(lines: string[]): StatusSummary {
  const summary: StatusSummary = {
    totalEvents: 0,
    eventCounts: {},
    latestCorrelationByItemId: {},
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    let parsed: LogEvent;
    try {
      parsed = JSON.parse(line) as LogEvent;
    } catch {
      continue;
    }

    summary.totalEvents += 1;

    const event = typeof parsed.event === "string" ? parsed.event : "unknown";
    summary.eventCounts[event] = (summary.eventCounts[event] ?? 0) + 1;

    if (typeof parsed.item_id === "string" && typeof parsed.session_id === "string") {
      summary.latestCorrelationByItemId[parsed.item_id] = parsed.session_id;
    }
  }

  return summary;
}

export function run(): void {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error("Usage: npm run status -- <log-file>");
  }

  const content = readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const summary = summarizeStructuredLogs(lines);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1]?.endsWith("status.js")) {
  run();
}
