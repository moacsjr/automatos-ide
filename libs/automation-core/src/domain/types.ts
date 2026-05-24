export type ActionType = 'navigate' | 'click' | 'fill' | 'condition';

export interface AutomationStep {
  id: string;
  action: ActionType;
  description: string;
  params?: {
    url?: string;
    selector?: string;
    value?: string;
  };
  conditionConfig?: {
    condition: {
      type: 'element_visible' | 'text_contains';
      selector: string;
      expectedText?: string;
    };
    thenSteps: AutomationStep[];
    elseSteps?: AutomationStep[];
  };
}

export interface WorkflowJob {
  workflowId: string;
  executionId: string;
  dataSourceFileKey: string;
  steps: AutomationStep[];
}

export interface ExecutionContext {
  executionId: string;
  variables: Record<string, Record<string, string>>;
  logs: string[];
}
