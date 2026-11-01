import { createContext, useContext } from "react";

export const WorkflowContext = createContext(null);

export function useWorkflow() {
  const context = useContext(WorkflowContext);
  if (!context) {
    throw new Error("useWorkflow must be used within a WorkflowProvider.");
  }
  return context;
}
