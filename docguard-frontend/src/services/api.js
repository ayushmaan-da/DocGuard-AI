import axios from "axios";

export function getApiBaseUrl(environment = import.meta.env ?? {}) {
  const configuredApiUrl = environment.VITE_API_URL?.trim();
  return (configuredApiUrl || "http://localhost:3000/api").replace(/\/+$/, "");
}

export const API_BASE_URL = getApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 130_000,
  headers: {
    "Content-Type": "application/json"
  }
});

export async function getHealth() {
  const response = await api.get("/health");
  return response.data;
}

export async function ingestGithubRepository(input) {
  const response = await api.post("/projects/from-github", input);
  return response.data;
}

export async function uploadPdfDocuments(files) {
  const formData = new FormData();

  for (const file of files) {
    formData.append("documents", file, file.name);
  }

  const response = await api.post("/projects/documents", formData, {
    headers: { "Content-Type": null }
  });

  return response.data;
}

export async function analyzeProject(projectId) {
  const response = await api.post(
    `/projects/${encodeURIComponent(projectId)}/analyze`
  );

  return response.data;
}

export async function ingestPullRequest(pullRequestUrl) {
  const response = await api.post("/pull-requests/from-github", {
    pullRequestUrl
  });

  return response.data;
}

export async function analyzePullRequest(pullRequestUrl) {
  const response = await api.post(
    "/pull-requests/analyze",
    { pullRequestUrl },
    { timeout: 900_000 }
  );

  return response.data;
}

export function getApiErrorMessage(error) {
  const responseError = error?.response?.data?.error;

  if (
    typeof responseError?.message === "string" &&
    responseError.message.trim()
  ) {
    return responseError.message;
  }

  if (error?.code === "ECONNABORTED") {
    return "The request timed out. The analysis service may still be starting or unavailable.";
  }

  if (error?.code === "ERR_NETWORK") {
    return `Could not connect to the backend at ${API_BASE_URL}. Check that it is running and that VITE_API_URL is correct.`;
  }

  if (!error?.response && error instanceof Error) {
    return error.message;
  }

  if (!error?.response) {
    return `Could not connect to the backend at ${API_BASE_URL}. Check that it is running and that VITE_API_URL is correct.`;
  }

  return "The backend returned an unexpected response. Please try again.";
}

export default api;