import { useState } from "react";
import { Search } from "lucide-react";

import SeverityTag from "../components/SeverityTag";
import { mockIssues } from "../data/mockData";

import "./DocumentationIssues.css";

const DocumentationIssues = () => {
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("All");
  const [status, setStatus] = useState("All");

  const q = search.toLowerCase();
  const issues = mockIssues.filter(
    (issue) =>
      (issue.file.toLowerCase().includes(q) ||
        issue.repository.toLowerCase().includes(q) ||
        issue.description.toLowerCase().includes(q)) &&
      (severity === "All" || issue.severity === severity) &&
      (status === "All" || issue.status === status)
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Documentation issues</h1>
          <p>Every place DocGuard found docs that no longer match the code.</p>
        </div>
      </header>

      <div className="issues-toolbar">
        <label className="input">
          <Search size={16} />
          <input
            placeholder="Search by file, repository or description"
            aria-label="Search issues"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
          <option value="All">All severities</option>
          <option>Critical</option>
          <option>High</option>
          <option>Medium</option>
          <option>Low</option>
        </select>

        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="All">All statuses</option>
          <option>Open</option>
          <option>Resolved</option>
        </select>
      </div>

      <p className="muted issues-count" role="status">
        {issues.length} {issues.length === 1 ? "issue" : "issues"}
      </p>

      {issues.length === 0 ? (
        <div className="empty">
          <strong>No issues match these filters</strong>
          Clear the search or choose “All” to see everything.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table issues-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Repository</th>
                <th>Issue</th>
                <th>Severity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.id}>
                  <td className="path">{issue.file}:{issue.line}</td>
                  <td>{issue.repository}</td>
                  <td>{issue.description}</td>
                  <td><SeverityTag severity={issue.severity} /></td>
                  <td><span className={`status ${issue.status.toLowerCase()}`}>{issue.status}</span></td>
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
