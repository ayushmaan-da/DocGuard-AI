import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle } from "lucide-react";

import SeverityTag from "../components/SeverityTag";
import { useWorkflow } from "../workflow-context";

import "./AnalysisResults.css";

const filters = ["All", "Critical", "High", "Medium", "Low", "Info"];

function getReferences(value) {
  return Array.isArray(value) ? value.filter((reference) => (
    reference && typeof reference.path === "string"
  )) : [];
}

function sourceLocation(reference) {
  if (!Number.isSafeInteger(reference.startLine)) return reference.path;
  const end = Number.isSafeInteger(reference.endLine) && reference.endLine !== reference.startLine
    ? `-${reference.endLine}`
    : "";
  return `${reference.path}:${reference.startLine}${end}`;
}

const AnalysisResults = () => {
  const { projects } = useWorkflow();
  const analyzedProjects = projects
    .filter((project) => project.analysis)
    .sort((left, right) => Date.parse(right.analyzedAt ?? 0) - Date.parse(left.analyzedAt ?? 0));
  const latestProject = analyzedProjects[0];
  const [projectId, setProjectId] = useState(latestProject?.projectId ?? "");
  const project = analyzedProjects.find((item) => item.projectId === projectId) ?? latestProject;
  const analysis = project?.analysis;
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  const [filter, setFilter] = useState("All");
  const visible = findings
    .map((finding, index) => ({ ...finding, id: `${project?.projectId}-${index}` }))
    .filter((finding) => filter === "All"
      || String(finding.severity ?? "info").toLowerCase() === filter.toLowerCase());
  const [selectedId, setSelectedId] = useState("");
  const selected = visible.find((finding) => finding.id === selectedId) ?? visible[0];

  const countFor = (value) => (
    value === "All"
      ? findings.length
      : findings.filter((finding) => (
        String(finding.severity ?? "info").toLowerCase() === value.toLowerCase()
      )).length
  );

  if (!analysis) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1>Analysis results</h1>
            <p>Analysis output from the configured backend analyser appears here.</p>
          </div>
        </header>
        <div className="empty">
          <strong>No repository analysis is available yet</strong>
          Connect a repository to run an analysis using the backend.
          <Link className="link-button" to="/repositories">Go to repositories</Link>
        </div>
      </div>
    );
  }

  const sourceUrl = project.source?.repositoryUrl;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>
            {sourceUrl
              ? <a href={sourceUrl} target="_blank" rel="noreferrer">{project.repositoryName ?? project.source?.repositoryUrl}</a>
              : project.repositoryName ?? "Project analysis"}
          </h1>
          <p>
            {project.source?.ref && <><code>{project.source.ref}</code>{project.source?.commitSha && " · "}</>}
            {project.source?.commitSha && <code>{project.source.commitSha.slice(0, 12)}</code>}
          </p>
        </div>
        <span className="status clean"><CheckCircle size={15} /> Analysis complete</span>
      </header>

      {analyzedProjects.length > 1 && (
        <label className="analysis-project-select">
          <span>Analysis</span>
          <select
            value={project.projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setSelectedId("");
              setFilter("All");
            }}
          >
            {analyzedProjects.map((item) => (
              <option key={item.projectId} value={item.projectId}>
                {item.repositoryName ?? item.source?.repositoryUrl ?? item.projectId}
              </option>
            ))}
          </select>
        </label>
      )}

      <dl className="summary">
        <div><dt>Source files</dt><dd>{project.summary?.sourceFiles ?? "—"}</dd></div>
        <div><dt>Documentation files</dt><dd>{project.summary?.documentationFiles ?? "—"}</dd></div>
        <div><dt>Findings</dt><dd>{findings.length}</dd></div>
      </dl>

      {typeof analysis.summary === "string" && (
        <p className="analysis-summary">{analysis.summary}</p>
      )}
      {Array.isArray(project.warnings) && project.warnings.length > 0 && (
        <ul className="analysis-warnings">
          {project.warnings.map((warning, index) => (
            <li key={`${warning.code ?? "warning"}-${index}`}>
              {typeof warning.message === "string" ? warning.message : "The backend reported a project warning."}
            </li>
          ))}
        </ul>
      )}

      <div className="results-toolbar" role="tablist" aria-label="Filter by severity">
        {filters.map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={filter === value}
            className={`chip ${filter === value ? "on" : ""}`}
            onClick={() => setFilter(value)}
          >
            {value} <span>{countFor(value)}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          <strong>{findings.length === 0 ? "No findings returned" : `No ${filter.toLowerCase()} findings`}</strong>
          {findings.length === 0
            ? "The backend analyser found no reportable documentation inconsistencies."
            : "Choose another severity to see the other findings."}
        </div>
      ) : (
        <div className="results-content">
          <ul className="results-list">
            {visible.map((finding) => (
              <li key={finding.id}>
                <button
                  className={`result-issue ${selected?.id === finding.id ? "selected" : ""}`}
                  aria-pressed={selected?.id === finding.id}
                  onClick={() => setSelectedId(finding.id)}
                >
                  <span className="result-desc">{finding.title ?? "Untitled finding"}</span>
                  <SeverityTag severity={finding.severity} />
                </button>
              </li>
            ))}
          </ul>

          {selected && (
            <article className="issue-detail" aria-live="polite">
              <div className="issue-detail-head">
                <h2>{selected.title ?? "Untitled finding"}</h2>
                <SeverityTag severity={selected.severity} />
              </div>
              {typeof selected.explanation === "string" && <p>{selected.explanation}</p>}

              {getReferences(selected.sourceReferences).length > 0 && (
                <section>
                  <h3>Source references</h3>
                  <ul>
                    {getReferences(selected.sourceReferences).map((reference, index) => (
                      <li key={`${reference.path}-${index}`}><code>{sourceLocation(reference)}</code></li>
                    ))}
                  </ul>
                </section>
              )}

              {getReferences(selected.documentationReferences).length > 0 && (
                <section>
                  <h3>Documentation references</h3>
                  <ul>
                    {getReferences(selected.documentationReferences).map((reference, index) => (
                      <li key={`${reference.path}-${index}`}>
                        <code>{reference.path}{Number.isSafeInteger(reference.pageNumber) ? `, page ${reference.pageNumber}` : ""}</code>
                        {typeof reference.quote === "string" && reference.quote && <blockquote>{reference.quote}</blockquote>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {typeof selected.recommendation === "string" && selected.recommendation && (
                <section>
                  <h3>Recommendation</h3>
                  <p>{selected.recommendation}</p>
                </section>
              )}
            </article>
          )}
        </div>
      )}
    </div>
  );
};

export default AnalysisResults;
