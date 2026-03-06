export type WorkItemState = "todo" | "in_progress" | "blocked" | "done";

export interface WorkItem {
  id: string;
  identifier: string;
  title: string;
  description: string;
  priority?: string;
  state: WorkItemState;
  labels: string[];
  url: string;
  blocked_by: string[];
}

export type NormalizedWorkItem = WorkItem;

export interface GitHubLinkedContent {
  id: string;
  number: number;
  title: string;
  body?: string | null;
  state?: string | null;
  labels?: string[];
  url: string;
}

export interface GitHubProjectItem {
  id: string;
  priority?: string | null;
  status?: string | null;
  blockedBy?: Array<string | number>;
  content: GitHubLinkedContent;
}

const STATE_ALIASES: Record<string, WorkItemState> = {
  todo: "todo",
  backlog: "todo",
  "to do": "todo",
  open: "todo",
  "in progress": "in_progress",
  in_progress: "in_progress",
  doing: "in_progress",
  blocked: "blocked",
  done: "done",
  closed: "done",
};

export function normalizeState(raw: string | undefined | null): WorkItemState {
  const normalized = (raw ?? "").trim().toLowerCase();
  return STATE_ALIASES[normalized] ?? "todo";
}

export function sanitizeWorkspaceKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function toWorkItem(item: GitHubProjectItem, repositorySlug: string): WorkItem {
  const fallbackState = normalizeState(item.content.state);
  const projectState = normalizeState(item.status);

  return {
    id: item.content.id,
    identifier: `${repositorySlug}#${item.content.number}`,
    title: item.content.title,
    description: item.content.body ?? "",
    priority: item.priority ?? undefined,
    state: item.status ? projectState : fallbackState,
    labels: item.content.labels ?? [],
    url: item.content.url,
    blocked_by: (item.blockedBy ?? []).map((v) => String(v)),
  };
}
