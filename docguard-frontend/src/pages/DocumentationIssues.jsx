import { useState } from "react";
import { Search } from "lucide-react";

import SeverityTag from "../components/SeverityTag";
import { useWorkflow } from "../workflow-context";

import "./DocumentationIssues.css";

function getPathReferences(references) {
  return Array.isArray(references)
    ? references.filter((reference) => reference && typeof reference.path === "string")
    : [];
}

const DocumentationIssues = () => {
  const { projects } = useWorkflow();
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("All");

  const findings = projects.flatMap((project) => (
    Array.isArray(project.analysis?.findings)
      ? project.analysis.findings.map((finding, index) => ({
        ...finding,
        id: `${project.projectId}-${index}`,
        repository: project.repositoryName ?? project.source?.repositoryUrl ?? "Project",
        projectId: project.projectId
      }))
      : []
  ));
  const query = search.toLowerCase();
  const visible = findings.filter((finding) => {
    const sourcePaths = getPathReferences(finding.sourceReferences).map((reference) => reference.path);
    const documentationPaths = getPathReferences(finding.documentationReferences).map((reference) => reference.path);
    const searchable = [
      finding.repository,
      finding.title,
      finding.explanation,
      finding.recommendation,
      ...sourcePaths,
      ...documentationPaths
    ].filter((value) => typeof value === "string").join(" ").toLowerCase();
    return searchable.includes(query)
      && (severity === "All" || String(finding.severity ?? "info").toLowerCase() === severity.toLowerCase());
  });

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Documentation findings</h1>
          <p>Findings returned by the backend analyses in this browser session.</p>
        </div>
      </header>

      <div className="issues-toolbar">
        <label className="input">
          <Search size={16} />
          <input
            placeholder="Search repository, file or finding"
            aria-label="Search findings"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <select value={severity} onChange={(event) => setSeverity(event.target.value)} aria-label="Severity">
          <option value="All">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="info">Info</option>
        </select>
      </div>

      <p className="muted issues-count" role="status">
        {visible.length} {visible.length === 1 ? "finding" : "findings"}
      </p>

      {visible.length === 0 ? (
        <div className="empty">
          <strong>{findings.length ? "No findings match these filters" : "No backend findings are available"}</strong>
          {findings.length
            ? "Clear the search or choose “All severities” to see other findings."
            : "Connect and analyze a repository to see real results here."}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table issues-table">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Finding</th>
                <th>Source references</th>
                <th>Documentation references</th>
                <th>Severity</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((finding) => (
                <tr key={finding.id}>
                  <td>{finding.repository}</td>
                  <td>
                    <strong>{finding.title ?? "Untitled finding"}</strong>
                    {typeof finding.explanation === "string" && <p>{finding.explanation}</p>}
                    {typeof finding.recommendation === "string" && finding.recommendation && (
                      <p className="muted"><strong>Recommendation:</strong> {finding.recommendation}</p>
                    )}
                  </td>
                  <td>
                    {getPathReferences(finding.sourceReferences).map((reference, index) => (
                      <div className="path" key={`${reference.path}-${index}`}>
                        {reference.path}
                        {Number.isSafeInteger(reference.startLine) ? `:${reference.startLine}` : ""}
                        {Number.isSafeInteger(reference.endLine) && reference.endLine !== reference.startLine
                          ? `-${reference.endLine}`
                          : ""}
                      </div>
                    ))}
                    {getPathReferences(finding.sourceReferences).length === 0 && "—"}
                  </td>
                  <td>
                    {getPathReferences(finding.documentationReferences).map((reference, index) => (
                      <div key={`${reference.path}-${index}`}>
                        <span className="path">{reference.path}</span>
                        {Number.isSafeInteger(reference.pageNumber) ? `, page ${reference.pageNumber}` : ""}
                        {typeof reference.quote === "string" && reference.quote && <blockquote>{reference.quote}</blockquote>}
                      </div>
                    ))}
                    {getPathReferences(finding.documentationReferences).length === 0 && "—"}
                  </td>
                  <td><SeverityTag severity={finding.severity} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default DocumentationIssues;
