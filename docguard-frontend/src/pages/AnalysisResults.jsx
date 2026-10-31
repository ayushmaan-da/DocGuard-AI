import { useState } from "react";
import { CheckCircle } from "lucide-react";

import DriftDiff from "../components/DriftDiff";
import SeverityTag from "../components/SeverityTag";
import { mockAnalysis } from "../data/mockData";

import "./AnalysisResults.css";

const filters = ["All", "Critical", "High", "Medium", "Low"];

const AnalysisResults = () => {
  const [filter, setFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(mockAnalysis.issues[0]?.id);

  const visible = mockAnalysis.issues.filter(
    (issue) => filter === "All" || issue.severity === filter
  );
  const selected = visible.find((i) => i.id === selectedId) ?? visible[0];

  const countFor = (f) =>
    f === "All"
      ? mockAnalysis.issues.length
      : mockAnalysis.issues.filter((i) => i.severity === f).length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>
            {mockAnalysis.repository} {mockAnalysis.pullRequest}
          </h1>
          <p>
            <code>{mockAnalysis.branch}</code> into <code>{mockAnalysis.baseBranch}</code>
          </p>
        </div>
        <span className="status clean"><CheckCircle size={15} /> Check complete</span>
      </header>

      <dl className="summary">
        <div><dt>Files changed</dt><dd>{mockAnalysis.filesChanged}</dd></div>
        <div><dt>Documentation files</dt><dd>{mockAnalysis.documentationFiles}</dd></div>
        <div><dt>Places docs disagree</dt><dd>{mockAnalysis.totalIssues}</dd></div>
      </dl>

      <div className="results-toolbar" role="tablist" aria-label="Filter by severity">
        {filters.map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            className={`chip ${filter === f ? "on" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f} <span>{countFor(f)}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          <strong>No {filter.toLowerCase()} issues in this pull request</strong>
          Choose another severity to see the rest.
        </div>
      ) : (
        <div className="results-content">
          <ul className="results-list">
            {visible.map((issue) => (
              <li key={issue.id}>
                <button
                  className={`result-issue ${selected?.id === issue.id ? "selected" : ""}`}
                  aria-pressed={selected?.id === issue.id}
                  onClick={() => setSelectedId(issue.id)}
                >
                  <span className="path">{issue.file}:{issue.line}</span>
                  <span className="result-desc">{issue.description}</span>
                  <SeverityTag severity={issue.severity} />
                </button>
              </li>
            ))}
          </ul>

          {selected && (
            <article className="issue-detail" aria-live="polite">
              <div className="issue-detail-head">
                <h2>{selected.type}</h2>
                <SeverityTag severity={selected.severity} />
              </div>
              <p className="muted">{selected.description}</p>
              <DriftDiff
                file={selected.file}
                line={selected.line}
                documented={selected.documented}
                actual={selected.actual}
              />
              <p className="muted">Repository: {selected.repository}</p>
            </article>
          )}
        </div>
      )}
    </div>
  );
};

export default AnalysisResults;
