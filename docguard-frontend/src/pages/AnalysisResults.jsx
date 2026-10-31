import { useState } from "react";

import {
  AlertTriangle,
  FileText,
  GitPullRequest,
  CheckCircle,
  Code,
  ExternalLink
} from "lucide-react";

import { mockAnalysis } from "../data/mockData";

import "./AnalysisResults.css";

const AnalysisResults = () => {
  const [selectedIssue, setSelectedIssue] = useState(
    mockAnalysis.issues[0]
  );

  const [filter, setFilter] = useState("All");

  const filteredIssues = mockAnalysis.issues.filter((issue) => {
    return filter === "All" || issue.severity === filter;
  });

  const severityClass = (severity) => {
    return severity.toLowerCase();
  };

  return (
    <div className="results-page">

      <div className="results-heading">
        <div>
          <p className="eyebrow">ANALYSIS REPORT</p>
          <h1>Analysis Results</h1>
          <p>Documentation drift detected in your pull request.</p>
        </div>

        <span className="completed-badge">
          <CheckCircle size={15} />
          Analysis Completed
        </span>
      </div>

      <div className="analysis-repo-card">
        <div>
          <GitPullRequest size={22} />

          <div>
            <h3>{mockAnalysis.repository}</h3>
            <p>Pull Request {mockAnalysis.pullRequest}</p>
          </div>
        </div>

        <div className="branch-info">
          {mockAnalysis.branch} → {mockAnalysis.baseBranch}
        </div>
      </div>

      <div className="result-stats">

        <div className="result-stat">
          <FileText size={21} />
          <span>Files Changed</span>
          <h2>{mockAnalysis.filesChanged}</h2>
        </div>

        <div className="result-stat">
          <GitPullRequest size={21} />
          <span>Documentation Files</span>
          <h2>{mockAnalysis.documentationFiles}</h2>
        </div>

        <div className="result-stat">
          <AlertTriangle size={21} />
          <span>Drift Detected</span>
          <h2>{mockAnalysis.totalIssues}</h2>
        </div>

      </div>

      <section className="results-panel">

        <div className="results-panel-heading">
          <div>
            <h2>Detected Issues</h2>
            <p>Potential documentation inconsistencies.</p>
          </div>

          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option>All</option>
            <option>Critical</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </div>

        <div className="results-content">

          <div className="results-issue-list">

            {filteredIssues.length === 0 ? (
              <p className="empty-results">
                No issues found for this severity.
              </p>
            ) : (

              filteredIssues.map((issue) => (

                <button
                  key={issue.id}
                  className={`result-issue ${
                    selectedIssue?.id === issue.id ? "selected" : ""
                  }`}
                  onClick={() => setSelectedIssue(issue)}
                >

                  <div>
                    <strong>{issue.file}</strong>
                    <span>Line {issue.line}</span>
                  </div>

                  <p>{issue.description}</p>

                  <span className={`severity ${severityClass(issue.severity)}`}>
                    {issue.severity}
                  </span>

                </button>

              ))

            )}

          </div>

          {selectedIssue && (

            <div className="issue-detail">

              <div className="issue-detail-heading">
                <div>
                  <p>ISSUE DETAILS</p>
                  <h3>{selectedIssue.type}</h3>
                </div>

                <span className={`severity ${severityClass(selectedIssue.severity)}`}>
                  {selectedIssue.severity}
                </span>
              </div>

              <div className="detail-meta">
                <span>Repository: {selectedIssue.repository}</span>
                <span>File: {selectedIssue.file}</span>
                <span>Line: {selectedIssue.line}</span>
              </div>

              <h4>Outdated Documentation</h4>

              <div className="code-block outdated">
                <span>DOCUMENTATION</span>
                <code>{selectedIssue.documented}</code>
              </div>

              <h4>Current Implementation</h4>

              <div className="code-block actual">
                <span>SOURCE CODE</span>
                <code>{selectedIssue.actual}</code>
              </div>

              <div className="issue-explanation">
                <AlertTriangle size={18} />
                <p>{selectedIssue.description}</p>
              </div>

              <button className="source-button">
                <Code size={16} />
                Source reference
                <ExternalLink size={14} />
              </button>

            </div>

          )}

        </div>

      </section>

    </div>
  );
};

export default AnalysisResults;