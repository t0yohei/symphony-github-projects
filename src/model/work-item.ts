export type WorkItemState = "todo" | "in_progress" | "blocked" | "done";

export interface NormalizedWorkItem {
  id: string;
  number?: number;
  title: string;
  body?: string;
  state: WorkItemState;
  labels: string[];
  assignees: string[];
  url?: string;
  updatedAt: string;
}
