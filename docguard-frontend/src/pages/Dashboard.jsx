import {
  GitPullRequest,
  FileText,
  AlertTriangle,
  CheckCircle,
  ArrowUpRight,
  ArrowRight,
  GitBranch,
  Clock
} from "lucide-react";

import "./Dashboard.css";

const stats = [
  {
    title: "Repositories",
    value: "12",
    change: "+2 this week",
    icon: GitBranch,
    color: "purple"
  },
  {
    title: "PRs Analyzed",
    value: "48",
    change: "+12 this week",
    icon: GitPullRequest,
    color: "blue"
  },
  {
    title: "Drift Detected",
    value: "16",
    change: "4 critical issues",
    icon: AlertTriangle,
    color: "orange"
  },
  {
    title: "Documentation Health",
    value: "92%",
    change: "+5% this month",
    icon: CheckCircle,
    color: "green"
  }
];

const pullRequests = [
  {
    repository: "express-api",
    pr: "#142",
    title: "Update server configuration",
    issues: 3,
    status: "Issues Found",
    time: "10 min ago"
  },
  {
    repository: "react-dashboard",
    pr: "#89",
    title: "Refactor authentication",
    issues: 0,
    status: "Clean",
    time: "1 hour ago"
  },
  {
    repository: "payment-service",
    pr: "#56",
    title: "Change payment API parameters",
    issues: 2,
    status: "Issues Found",
    time: "3 hours ago"
  }
];

const criticalIssues = [
  {
    file: "README.md",
    description: "Documented default port does not match implementation.",
    severity: "High"
  },
  {
    file: "docs/api.md",
    description: "Outdated API parameter: user_id.",
    severity: "Medium"
  },
  {
    file: "docs/setup.md",
    description: "Deprecated configuration flag is still documented.",
    severity: "High"
  }
];

const Dashboard = () => {
  return (
    <div className="dashboard">

      {/* Welcome Section */}

      <section className="dashboard-header">

        <div>
          <p className="eyebrow">OVERVIEW</p>

          <h1>Welcome back, Developer 👋</h1>

          <p className="dashboard-subtitle">
            Here's what's happening with your documentation today.
          </p>
        </div>

        <button className="analyze-button">
          <GitPullRequest size={18} />
          Analyze Pull Request
          <ArrowUpRight size={16} />
        </button>

      </section>

      {/* Statistics */}

      <section className="stats-grid">

        {stats.map((stat) => {
          const Icon = stat.icon;

          return (
            <div className="stat-card" key={stat.title}>

              <div className="stat-top">
                <span>{stat.title}</span>

                <div className={`stat-icon ${stat.color}`}>
                  <Icon size={20} />
                </div>
              </div>

              <h2>{stat.value}</h2>

              <p>{stat.change}</p>

            </div>
          );
        })}

      </section>

      {/* Documentation Health */}

      <section className="health-section">

        <div className="section-title">
          <div>
            <h2>Documentation Health</h2>
            <p>Overall health across connected repositories.</p>
          </div>

          <span className="health-label">Healthy</span>
        </div>

        <div className="health-content">

          <div className="health-score">
            <h1>92%</h1>
            <p>Documentation consistency score</p>
          </div>

          <div className="health-bar">
            <div className="health-progress"></div>
          </div>

          <div className="health-details">
            <span>92% Consistent</span>
            <span>8% Potential drift</span>
          </div>

        </div>

      </section>

      {/* Recent Pull Requests */}

      <section className="content-panel">

        <div className="section-title">

          <div>
            <h2>Recent Pull Requests</h2>
            <p>Latest pull requests analyzed by DocGuard.</p>
          </div>

          <button className="text-button">
            View all <ArrowRight size={15} />
          </button>

        </div>

        <div className="table-wrapper">

          <table className="pr-table">

            <thead>
              <tr>
                <th>Repository</th>
                <th>Pull Request</th>
                <th>Issues</th>
                <th>Status</th>
                <th>Last Analyzed</th>
              </tr>
            </thead>

            <tbody>

              {pullRequests.map((pr) => (

                <tr key={pr.pr}>

                  <td>
                    <div className="repo-name">
                      <GitBranch size={16} />
                      {pr.repository}
                    </div>
                  </td>

                  <td>
                    <div className="pr-info">
                      <strong>{pr.pr}</strong>
                      <span>{pr.title}</span>
                    </div>
                  </td>

                  <td>{pr.issues}</td>

                  <td>
                    <span className={`pr-status ${
                      pr.issues === 0 ? "clean" : "warning"
                    }`}>
                      {pr.status}
                    </span>
                  </td>

                  <td>
                    <span className="time-text">
                      <Clock size={13} />
                      {pr.time}
                    </span>
                  </td>

                </tr>

              ))}

            </tbody>

          </table>

        </div>

      </section>

      {/* Critical Issues */}

      <section className="content-panel issues-panel">

        <div className="section-title">

          <div>
            <h2>Detected Documentation Issues</h2>
            <p>Potential inconsistencies requiring attention.</p>
          </div>

          <button className="text-button">
            View all <ArrowRight size={15} />
          </button>

        </div>

        <div className="issues-list">

          {criticalIssues.map((issue) => (

            <div className="dashboard-issue" key={issue.file}>

              <div className="issue-file-icon">
                <FileText size={19} />
              </div>

              <div className="issue-description">
                <strong>{issue.file}</strong>
                <p>{issue.description}</p>
              </div>

              <span className={`severity ${issue.severity.toLowerCase()}`}>
                {issue.severity}
              </span>

            </div>

          ))}

        </div>

      </section>

    </div>
  );
};

export default Dashboard;