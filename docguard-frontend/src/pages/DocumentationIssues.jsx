import { useState } from "react";

import {
  AlertTriangle,
  Search,
  FileText
} from "lucide-react";

import { mockIssues } from "../data/mockData";

import "./DocumentationIssues.css";

const DocumentationIssues = () => {
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("All");
  const [status, setStatus] = useState("All");

  const filteredIssues = mockIssues.filter((issue) => {

    const matchesSearch =
      issue.file.toLowerCase().includes(search.toLowerCase()) ||
      issue.repository.toLowerCase().includes(search.toLowerCase()) ||
      issue.description.toLowerCase().includes(search.toLowerCase());

    const matchesSeverity =
      severity === "All" || issue.severity === severity;

    const matchesStatus =
      status === "All" || issue.status === status;

    return matchesSearch && matchesSeverity && matchesStatus;

  });

  return (
    <div className="documentation-issues-page">

      <div className="issues-heading">
        <div>
          <p className="eyebrow">ISSUE MANAGEMENT</p>
          <h1>Documentation Issues</h1>
          <p>Review and manage detected documentation drift.</p>
        </div>
      </div>

      <div className="issues-toolbar">

        <div className="issue-search">
          <Search size={18} />

          <input
            placeholder="Search issues..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
        >
          <option value="All">All Severities</option>
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="All">All Statuses</option>
          <option value="Open">Open</option>
          <option value="Resolved">Resolved</option>
        </select>

      </div>

      <div className="issues-count">
        <AlertTriangle size={18} />
        {filteredIssues.length} issues found
      </div>

      <div className="issues-table-wrapper">

        <table className="issues-table">

          <thead>
            <tr>
              <th>Repository</th>
              <th>Documentation</th>
              <th>Issue</th>
              <th>Severity</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>

            {filteredIssues.map((issue) => (

              <tr key={issue.id}>

                <td>{issue.repository}</td>

                <td>
                  <div className="issue-document">
                    <FileText size={16} />
                    {issue.file}
                    <span>:{issue.line}</span>
                  </div>
                </td>

                <td>{issue.description}</td>

                <td>
                  <span className={`severity ${issue.severity.toLowerCase()}`}>
                    {issue.severity}
                  </span>
                </td>

                <td>
                  <span className={`issue-status ${issue.status.toLowerCase()}`}>
                    {issue.status}
                  </span>
                </td>

              </tr>

            ))}

          </tbody>

        </table>

        {filteredIssues.length === 0 && (
          <p className="no-issues">
            No matching documentation issues found.
          </p>
        )}

      </div>

    </div>
  );
};

export default DocumentationIssues;