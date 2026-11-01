import { useCallback, useRef, useState } from "react";
import { WorkflowContext } from "./workflow-context";

const STORAGE_KEY = "docguard-workflow";
const EMPTY_WORKFLOW = { projects: [], pullRequests: [] };

function readWorkflow() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...EMPTY_WORKFLOW, warning: "" };
    const parsed = JSON.parse(stored);
    if (!parsed || !Array.isArray(parsed.projects) || !Array.isArray(parsed.pullRequests)) {
      throw new Error("Saved workflow data has an unexpected format.");
    }
    return { ...parsed, warning: "" };
  } catch (error) {
    console.error("Unable to read saved DocGuard workflow data:", error);
    return {
      ...EMPTY_WORKFLOW,
      warning: "Saved session data could not be read. New results will still be available in this tab."
    };
  }
}

export function WorkflowProvider({ children }) {
  const [initialWorkflow] = useState(readWorkflow);
  const [projects, setProjects] = useState(initialWorkflow.projects);
  const [pullRequests, setPullRequests] = useState(initialWorkflow.pullRequests);
  const [backendStatus, setBackendStatus] = useState({ state: "checking", message: "" });
  const [storageWarning, setStorageWarning] = useState(initialWorkflow.warning);
  const projectsRef = useRef(projects);
  const pullRequestsRef = useRef(pullRequests);

  const updateWorkflow = useCallback((nextProjects, nextPullRequests) => {
    projectsRef.current = nextProjects;
    pullRequestsRef.current = nextPullRequests;
    setProjects(nextProjects);
    setPullRequests(nextPullRequests);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        projects: nextProjects,
        pullRequests: nextPullRequests
      }));
      setStorageWarning("");
    } catch (error) {
      console.error("Unable to save DocGuard workflow data:", error);
      setStorageWarning("This browser could not save session data. Results remain available until this tab closes.");
    }
  }, []);

  const saveProject = useCallback((project) => {
    const nextProjects = [
      { ...project, createdAt: project.createdAt ?? new Date().toISOString() },
      ...projectsRef.current.filter((item) => item.projectId !== project.projectId)
    ];
    updateWorkflow(nextProjects, pullRequestsRef.current);
  }, [updateWorkflow]);

  const saveAnalysis = useCallback((projectId, analysis) => {
    const nextProjects = projectsRef.current.map((project) => (
      project.projectId === projectId
        ? { ...project, analysis, analyzedAt: new Date().toISOString() }
        : project
    ));
    updateWorkflow(nextProjects, pullRequestsRef.current);
  }, [updateWorkflow]);

  const savePullRequest = useCallback((result) => {
    const context = result.changeContext ?? {};
    const changeGroups = ["sourceChanges", "documentationChanges", "binaryChanges", "otherChanges"];
    const savedChangeContext = {
      summary: context.summary ?? {}
    };
    for (const group of changeGroups) {
      savedChangeContext[group] = (Array.isArray(context[group]) ? context[group] : []).map(({
        path,
        originalPath,
        status,
        classification,
        patchStatus
      }) => ({ path, originalPath, status, classification, patchStatus }));
    }

    const nextPullRequests = [
      {
        source: result.source,
        pullRequest: result.pullRequest,
        changeContext: savedChangeContext,
        driftAnalysis: result.driftAnalysis,
        fetchedAt: new Date().toISOString()
      },
      ...pullRequestsRef.current.filter((item) => item.pullRequest?.url !== result.pullRequest?.url)
    ];
    updateWorkflow(projectsRef.current, nextPullRequests);
  }, [updateWorkflow]);

  const value = {
    projects,
    pullRequests,
    backendStatus,
    setBackendStatus,
    storageWarning,
    saveProject,
    saveAnalysis,
    savePullRequest
  };

  return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>;
}
