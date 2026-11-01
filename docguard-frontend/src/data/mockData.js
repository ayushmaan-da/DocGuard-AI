export const mockRepositories = [
  {
    id: 1,
    name: "express-api",
    owner: "developer",
    url: "https://github.com/expressjs/express",
    analyzedPRs: 24,
    issues: 8,
    health: 88,
    lastAnalyzed: "10 minutes ago",
    status: "Connected"
  },
  {
    id: 2,
    name: "react-dashboard",
    owner: "developer",
    url: "https://github.com/facebook/react",
    analyzedPRs: 18,
    issues: 3,
    health: 96,
    lastAnalyzed: "1 hour ago",
    status: "Connected"
  },
  {
    id: 3,
    name: "payment-service",
    owner: "developer",
    url: "https://github.com/stripe/stripe-node",
    analyzedPRs: 12,
    issues: 5,
    health: 82,
    lastAnalyzed: "3 hours ago",
    status: "Connected"
  }
];

export const mockIssues = [
  {
    id: 1,
    repository: "express-api",
    file: "README.md",
    line: 42,
    description: "Documented default port does not match implementation.",
    documented: "The server runs on port 3000 by default.",
    actual: "const PORT = 8080;",
    severity: "Critical",
    status: "Open",
    type: "Incorrect default"
  },
  {
    id: 2,
    repository: "react-dashboard",
    file: "docs/api.md",
    line: 67,
    description: "An outdated API parameter is still documented.",
    documented: "The API accepts the parameter user_id.",
    actual: "The API now accepts account_id.",
    severity: "High",
    status: "Open",
    type: "Outdated parameter"
  },
  {
    id: 3,
    repository: "payment-service",
    file: "docs/setup.md",
    line: 21,
    description: "Deprecated configuration flag is still documented.",
    documented: "Set ENABLE_LEGACY_MODE=true.",
    actual: "ENABLE_LEGACY_MODE has been removed.",
    severity: "Medium",
    status: "Open",
    type: "Removed configuration"
  },
  {
    id: 4,
    repository: "express-api",
    file: "docs/configuration.md",
    line: 35,
    description: "Configuration documentation references an old timeout.",
    documented: "The default timeout is 30 seconds.",
    actual: "The default timeout is 60 seconds.",
    severity: "Low",
    status: "Resolved",
    type: "Incorrect default"
  }
];

export const mockAnalysis = {
  repository: "express-api",
  pullRequest: "#142",
  branch: "feature/update-config",
  baseBranch: "main",
  filesChanged: 8,
  documentationFiles: 3,
  totalIssues: 3,
  status: "Completed",
  issues: mockIssues.slice(0, 3)
};