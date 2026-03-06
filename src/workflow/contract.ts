export interface WorkflowContract {
  name: string;
  version: string;
  tracker: "github-projects";
  pollIntervalMs: number;
  maxConcurrency: number;
}

export interface WorkflowLoader {
  load(path: string): Promise<WorkflowContract>;
}

export class NotImplementedWorkflowLoader implements WorkflowLoader {
  async load(_path: string): Promise<WorkflowContract> {
    throw new Error("WORKFLOW.md loader not implemented yet");
  }
}
