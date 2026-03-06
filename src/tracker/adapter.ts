import type { NormalizedWorkItem } from "../model/work-item.js";

export interface TrackerAdapter {
  listEligibleItems(): Promise<NormalizedWorkItem[]>;
  markInProgress(itemId: string): Promise<void>;
  markDone(itemId: string): Promise<void>;
}

export class GitHubProjectsAdapterPlaceholder implements TrackerAdapter {
  async listEligibleItems(): Promise<NormalizedWorkItem[]> {
    return [];
  }

  async markInProgress(_itemId: string): Promise<void> {
    throw new Error("GitHub Projects write path not implemented yet");
  }

  async markDone(_itemId: string): Promise<void> {
    throw new Error("GitHub Projects write path not implemented yet");
  }
}
