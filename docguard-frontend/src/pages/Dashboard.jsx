import { Link } from "react-router-dom";
import { GitPullRequest } from "lucide-react";

import SeverityTag from "../components/SeverityTag";
import { useWorkflow } from "../workflow-context";

import "./Dashboard.css";

const Dashboard = () => {
  const { projects, pullRequests } = useWorkflow();
  const analyzed = projects
    .filter((project) => project.analysis)
    .sort((left, right) => Date.parse(right.analyzedAt ?? 0) - Date.parse(left.analyzedAt ?? 0));
  const findings = analyzed.flatMap((project) => (
    Array.isArray(project.analysis.findings)
      ? project.analysis.findings.map((finding, index) => ({
        ...finding,
        id: `${project.projectId}-${index}`,
        repositoryName: project.repositoryName ?? project.source?.repositoryUrl ?? "Project",
        projectId: project.projectId
      }))
      : []
  ));
  const urgentFinding = findings[0];
  const recentProjects = [...projects].sort((a, b) => (
    Date.parse(b.analyzedAt ?? b.createdAt ?? 0) - Date.parse(a.analyzedAt ?? a.createdAt ?? 0)
  )).slice(0, 5);
  const recentPullRequests = pullRequests.slice(0, 5);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{projects.length ? "Workspace overview" : "Connect a repository to get started"}</h1>
          <p>
            {projects.length
              ? "Projects and findings returned by the backend during this browser session."
              : "Run a backend analysis of a public GitHub repository and its documentation."}
          </p>
        </div>
        <Link to="/repositories" className="btn">
          <GitPullRequest size={16} />
          Analyze a repository
        </Link>
      </header>

      <dl className="summary">
        <div><dt>Repositories submitted</dt><dd>{projects.length}</dd></div>
        <div><dt>Completed analyses</dt><dd>{analyzed.length}</dd></div>
        <div><dt>Backend findings</dt><dd>{findings.length}</dd></div>
      </dl>

      {urgentFinding && (
        <section className="dash-lead" aria-labelledby="lead-title">
          <div className="dash-lead-meta">
            <h2 id="lead-title">Latest finding</h2>
            <SeverityTag severity={urgentFinding.severity} />
            <span className="muted">{urgentFinding.repositoryName}</span>
          </div>
          <h3>{urgentFinding.title ?? "Untitled finding"}</h3>
          {typeof urgentFinding.explanation === "string" && <p className="dash-lead-text">{urgentFinding.explanation}</p>}
          {typeof urgentFinding.recommendation === "string" && urgentFinding.recommendation && (
            <p><strong>Recommendation:</strong> {urgentFinding.recommendation}</p>
          )}
          <Link to="/analysis-results" className="link-button">Review analysis results</Link>
        </section>
      )}

      <div className="dash-grid">
        <section aria-labelledby="projects-title">
          <h2 id="projects-title" className="section-title">Recent repository analyses</h2>
          {recentProjects.length === 0 ? (
            <div className="empty">No repositories have been submitted in this session.</div>
          ) : (
            <ul className="dashboard-projects">
              {recentProjects.map((project) => (
                <li key={project.projectId}>
                  <div>
                    <strong>{project.repositoryName ?? project.source?.repositoryUrl ?? "Project"}</strong>
                    <div className="muted">
                      {project.source?.ref ?? "Default branch"}
                      {project.analyzedAt ? ` · analyzed ${new Date(project.analyzedAt).toLocaleString()}` : " · not analyzed"}
                    </div>
                  </div>
                  <span>{Array.isArray(project.analysis?.findings) ? project.analysis.findings.length : "—"} findings</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="prs-title">
          <h2 id="prs-title" className="section-title">Recently fetched pull requests</h2>
          {recentPullRequests.length === 0 ? (
            <div className="empty">No pull request changes have been fetched in this session.</div>
          ) : (
            <ul className="dashboard-projects">
              {recentPullRequests.map((item) => (
                <li key={item.pullRequest?.url}>
                  <div>
                    <strong>{item.pullRequest?.title ?? item.pullRequest?.url ?? "Pull request"}</strong>
                    <div className="muted">{item.source?.repositoryUrl}</div>
                  </div>
                  <span>{item.changeContext?.summary?.totalFiles ?? 0} files · changes fetched</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {!urgentFinding && analyzed.length > 0 && (
        <p className="dashboard-clean-note">The most recent backend analysis returned no findings.</p>
      )}
    </div>
  );
};

export default Dashboard;
