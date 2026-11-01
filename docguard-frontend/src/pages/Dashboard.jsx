import { Link } from "react-router-dom";
import { GitPullRequest } from "lucide-react";

import DriftDiff from "../components/DriftDiff";
import SeverityTag from "../components/SeverityTag";
import { mockIssues, mockRepositories } from "../data/mockData";

import "./Dashboard.css";

const recentPullRequests = [
  { id: "express-api#142", repository: "express-api", number: 142, title: "Update server configuration", issues: 3, checked: "10 minutes ago" },
  { id: "react-dashboard#89", repository: "react-dashboard", number: 89, title: "Refactor authentication", issues: 0, checked: "1 hour ago" },
  { id: "payment-service#56", repository: "payment-service", number: 56, title: "Change payment API parameters", issues: 2, checked: "3 hours ago" }
];

const severityOrder = ["Critical", "High", "Medium", "Low"];

const Dashboard = () => {
  const openIssues = mockIssues.filter((i) => i.status === "Open");
  const topIssue = [...openIssues].sort(
    (a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)
  )[0];

  const prsChecked = mockRepositories.reduce((sum, r) => sum + r.analyzedPRs, 0);
  const avgHealth = Math.round(
    mockRepositories.reduce((sum, r) => sum + r.health, 0) / mockRepositories.length
  );

  const headline =
    openIssues.length === 0
      ? "Your docs match your code"
      : `${openIssues.length} open ${openIssues.length === 1 ? "issue" : "issues"} where docs and code disagree`;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{headline}</h1>
          <p>Checked across {mockRepositories.length} repositories. Most recent check ran 10 minutes ago.</p>
        </div>
        <Link to="/pull-requests" className="btn">
          <GitPullRequest size={16} />
          Check a pull request
        </Link>
      </header>

      {topIssue && (
        <section className="dash-lead" aria-labelledby="lead-title">
          <div className="dash-lead-meta">
            <h2 id="lead-title">Most urgent</h2>
            <SeverityTag severity={topIssue.severity} />
            <span className="muted">{topIssue.repository}</span>
          </div>
          <p className="dash-lead-text">{topIssue.description}</p>
          <DriftDiff
            file={topIssue.file}
            line={topIssue.line}
            documented={topIssue.documented}
            actual={topIssue.actual}
          />
          <Link to="/analysis-results" className="link-button">Review this issue</Link>
        </section>
      )}

      <dl className="summary">
        <div><dt>Repositories</dt><dd>{mockRepositories.length}</dd></div>
        <div><dt>Pull requests checked</dt><dd>{prsChecked}</dd></div>
        <div><dt>Docs in sync</dt><dd>{avgHealth}%</dd></div>
      </dl>

      <div className="dash-grid">
        <section aria-labelledby="prs-title">
          <h2 id="prs-title" className="section-title">Recent pull requests</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Pull request</th><th>Result</th><th>Checked</th></tr>
              </thead>
              <tbody>
                {recentPullRequests.map((pr) => (
                  <tr key={pr.id}>
                    <td>
                      <strong>{pr.title}</strong>
                      <div className="muted">{pr.repository} #{pr.number}</div>
                    </td>
                    <td>
                      <span className={`status ${pr.issues === 0 ? "clean" : "warning"}`}>
                        {pr.issues === 0 ? "In sync" : `${pr.issues} ${pr.issues === 1 ? "issue" : "issues"}`}
                      </span>
                    </td>
                    <td className="muted">{pr.checked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="health-title">
          <h2 id="health-title" className="section-title">Docs in sync, by repository</h2>
          <ul className="health-list">
            {[...mockRepositories].sort((a, b) => a.health - b.health).map((repo) => (
              <li key={repo.id}>
                <div className="health-row">
                  <span>{repo.name}</span>
                  <strong>{repo.health}%</strong>
                </div>
                <div className="bar" role="img" aria-label={`${repo.health}% in sync`}>
                  <div style={{ width: `${repo.health}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
};

export default Dashboard;
