import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, Plus, Search } from "lucide-react";

import { useWorkflow } from "../workflow-context";
import {
  analyzeProject,
  getApiErrorMessage,
  ingestGithubRepository,
  uploadPdfDocuments
} from "../services/api";

import "./Repositories.css";

function getRepositoryName(repositoryUrl, fallback) {
  if (typeof fallback === "string" && fallback) return fallback;
  return repositoryUrl?.replace(/\/+$/, "").split("/").slice(-1)[0] || "GitHub repository";
}

function validateAnalysisResponse(response, projectId) {
  if (response?.projectId !== projectId
    || !response.analysis
    || typeof response.analysis !== "object"
    || Array.isArray(response.analysis)
    || typeof response.analysis.summary !== "string"
    || !Array.isArray(response.analysis.findings)) {
    throw new Error("The backend returned an incomplete analysis response. Please retry the analysis.");
  }
}

const Repositories = () => {
  const navigate = useNavigate();
  const { projects, saveProject, saveAnalysis } = useWorkflow();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [documents, setDocuments] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const repos = projects.filter((project) => (
    getRepositoryName(project.source?.repositoryUrl, project.repositoryName)
      .toLowerCase()
      .includes(search.toLowerCase())
  ));

  const chooseDocuments = (files) => {
    const selected = Array.from(files ?? []);
    const invalid = selected.find((file) => !file.name.toLowerCase().endsWith(".pdf"));
    if (invalid) {
      setDocuments([]);
      setError(`${invalid.name} is not a PDF. Select only PDF documentation.`);
      return;
    }
    setError("");
    setDocuments(selected);
  };

  const requestAnalysis = async (projectId) => {
    const response = await analyzeProject(projectId);
    validateAnalysisResponse(response, projectId);
    saveAnalysis(projectId, response.analysis);
    navigate("/analysis-results");
  };

  const handleAnalyze = async (projectId) => {
    setError("");
    setBusy(true);
    setProgress("Analyzing the saved project…");
    try {
      await requestAnalysis(projectId);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    if (!repositoryUrl.trim()) {
      setError("Enter a GitHub repository URL.");
      return;
    }

    setBusy(true);
    let uploadedDocuments = [];
    try {
      let uploadedDocumentIds = [];
      if (documents.length > 0) {
        setProgress(`Uploading ${documents.length} PDF${documents.length === 1 ? "" : "s"}…`);
        const uploadResult = await uploadPdfDocuments(documents);
        if (!Array.isArray(uploadResult.documentation)
          || uploadResult.documentation.length !== documents.length
          || uploadResult.documentation.some((document) => !document.original?.referenceId)) {
          throw new Error("The backend did not return valid PDF references. The repository was not submitted.");
        }
        uploadedDocuments = uploadResult.documentation.map((document) => ({
          filename: document.filename,
          extractionStatus: document.extractionStatus,
          original: document.original
        }));
        uploadedDocumentIds = uploadedDocuments.map((document) => document.original.referenceId);
      }

      setProgress("Reading the GitHub repository…");
      const project = await ingestGithubRepository({
        repositoryUrl: repositoryUrl.trim(),
        ...(uploadedDocumentIds.length > 0 ? { uploadedDocumentIds } : {})
      });
      if (typeof project.projectId !== "string" || !project.projectId) {
        throw new Error("The backend did not return a project ID. Analysis was not started.");
      }

      const storedProject = {
        projectId: project.projectId,
        expiresAt: project.expiresAt,
        source: project.source,
        repositoryName: getRepositoryName(project.source?.repositoryUrl, project.project?.name),
        summary: project.summary,
        warnings: project.warnings ?? [],
        uploadedDocuments,
        analysis: null
      };
      saveProject(storedProject);

      setProgress("Analyzing source code and documentation…");
      await requestAnalysis(project.projectId);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Repositories</h1>
          <p>Analyze public GitHub repositories with their README or uploaded PDF documentation.</p>
        </div>
        <button className="btn" onClick={() => setShowForm((visible) => !visible)}>
          <Plus size={16} />
          {showForm ? "Close" : "Connect repository"}
        </button>
      </header>

      {showForm && (
        <form className="repository-form" onSubmit={handleSubmit}>
          <h2>Analyze a public GitHub repository</h2>
          <label className="field">
            <span>Repository URL</span>
            <input
              className="text-input"
              type="url"
              required
              placeholder="https://github.com/owner/repository"
              value={repositoryUrl}
              onChange={(event) => setRepositoryUrl(event.target.value)}
            />
            <small>The backend uses the repository README when you do not upload PDFs.</small>
          </label>
          <label className="field">
            <span>PDF documentation <span className="muted">(optional)</span></span>
            <input
              className="text-input file-input"
              type="file"
              accept=".pdf,application/pdf"
              multiple
              onChange={(event) => chooseDocuments(event.target.files)}
            />
            <small>
              {documents.length
                ? `${documents.length} PDF${documents.length === 1 ? "" : "s"} selected.`
                : "Multiple PDFs are supported. Each file is uploaded before repository ingestion."}
            </small>
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          {progress && <p className="muted" role="status">{progress}</p>}
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Working…" : "Connect and analyze"}
          </button>
        </form>
      )}

      {!showForm && error && <div className="form-error" role="alert">{error}</div>}
      {busy && !showForm && progress && <p className="muted" role="status">{progress}</p>}

      <label className="input repo-search">
        <Search size={16} />
        <input
          placeholder="Search analyzed repositories"
          aria-label="Search repositories"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

      {repos.length === 0 ? (
        <div className="empty">
          <strong>{projects.length ? `No repositories match “${search}”` : "No repositories analyzed in this session"}</strong>
          {projects.length ? "Try a different search, or connect a repository." : "Connect a public GitHub repository to get started."}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Source files</th>
                <th>Documentation</th>
                <th>Findings</th>
                <th>Branch</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {repos.map((repo) => {
                const name = getRepositoryName(repo.source?.repositoryUrl, repo.repositoryName);
                const documentationCount = repo.summary?.documentationFiles ?? 0;
                const findingCount = Array.isArray(repo.analysis?.findings) ? repo.analysis.findings.length : "—";
                return (
                  <tr key={repo.projectId}>
                    <td>
                      <strong>{name}</strong>
                      <div className="muted">{repo.source?.repositoryUrl}</div>
                    </td>
                    <td>{repo.summary?.sourceFiles ?? "—"}</td>
                    <td>{documentationCount}</td>
                    <td>{findingCount}</td>
                    <td className="muted">{repo.source?.ref ?? "—"}</td>
                    <td>
                      {repo.source?.repositoryUrl && (
                        <a
                          className="icon-link"
                          href={repo.source.repositoryUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${name} on GitHub`}
                        >
                          <ExternalLink size={16} />
                        </a>
                      )}
                      <button
                        type="button"
                        className="link-button"
                        disabled={busy}
                        onClick={() => handleAnalyze(repo.projectId)}
                      >
                        {repo.analysis ? "Re-analyze" : "Analyze"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="repository-note">
        Project references are held temporarily by the backend and expire; this browser keeps only metadata and analysis results for the current tab session.
      </p>
    </div>
  );
};

export default Repositories;
