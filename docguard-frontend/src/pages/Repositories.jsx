import { useState } from "react";

import {
  GitBranch,
  AlertTriangle,
  Search,
  ExternalLink,
  Plus
} from "lucide-react";

import { mockRepositories } from "../data/mockData";

import "./Repositories.css";

const Repositories = () => {
  const [search, setSearch] = useState("");

  const filteredRepositories = mockRepositories.filter((repo) =>
    repo.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="repositories-page">

      <div className="repository-heading">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1>Repositories</h1>
          <p>Manage your connected GitHub repositories.</p>
        </div>

        <button className="repository-add-button">
          <Plus size={17} />
          Connect Repository
        </button>
      </div>

      <div className="repository-search">
        <Search size={18} />
        <input
          placeholder="Search repositories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="repository-grid">

        {filteredRepositories.map((repo) => (

          <div className="repository-card" key={repo.id}>

            <div className="repository-card-top">
              <GitBranch size={24} />

              <span className="connected-status">
                {repo.status}
              </span>
            </div>

            <h3>{repo.name}</h3>
            <p className="repository-owner">{repo.owner}</p>

            <div className="repository-metrics">

              <div>
                <GitBranch size={16} />
                <span>{repo.analyzedPRs} PRs</span>
              </div>

              <div>
                <AlertTriangle size={16} />
                <span>{repo.issues} Issues</span>
              </div>

            </div>

            <div className="repository-health">
              <div>
                <span>Documentation health</span>
                <strong>{repo.health}%</strong>
              </div>

              <div className="repository-health-bar">
                <div style={{ width: `${repo.health}%` }}></div>
              </div>
            </div>

            <div className="repository-card-footer">
              <span>{repo.lastAnalyzed}</span>

              <a
                href={repo.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${repo.name} on GitHub`}
              >
                <ExternalLink size={16} />
              </a>
            </div>

          </div>

        ))}

        {filteredRepositories.length === 0 && (
          <p className="repository-empty">
            No repositories found.
          </p>
        )}

      </div>

    </div>
  );
};

export default Repositories;