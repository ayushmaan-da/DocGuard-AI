import { useState } from "react";
import { Search, ExternalLink, Plus } from "lucide-react";

import { mockRepositories } from "../data/mockData";

import "./Repositories.css";

const Repositories = () => {
  const [search, setSearch] = useState("");

  const repos = mockRepositories.filter((repo) =>
    repo.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Repositories</h1>
          <p>The GitHub repositories DocGuard watches for documentation drift.</p>
        </div>
        <button className="btn">
          <Plus size={16} />
          Connect repository
        </button>
      </header>

      <label className="input repo-search">
        <Search size={16} />
        <input
          placeholder="Search repositories"
          aria-label="Search repositories"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>

      {repos.length === 0 ? (
        <div className="empty">
          <strong>No repositories match “{search}”</strong>
          Try a different name, or connect a new repository.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Pull requests</th>
                <th>Open issues</th>
                <th>Docs in sync</th>
                <th>Last checked</th>
                <th><span className="sr-only">GitHub</span></th>
              </tr>
            </thead>
            <tbody>
              {repos.map((repo) => (
                <tr key={repo.id}>
                  <td>
                    <strong>{repo.name}</strong>
                    <div className="muted">{repo.owner}</div>
                  </td>
                  <td>{repo.analyzedPRs}</td>
                  <td>{repo.issues}</td>
                  <td>
                    <div className="repo-health">
                      <div className="bar" role="img" aria-label={`${repo.health}% in sync`}>
                        <div style={{ width: `${repo.health}%` }} />
                      </div>
                      <span>{repo.health}%</span>
                    </div>
                  </td>
                  <td className="muted">{repo.lastAnalyzed}</td>
                  <td>
                    <a
                      className="icon-link"
                      href={repo.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${repo.name} on GitHub`}
                    >
                      <ExternalLink size={16} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Repositories;
