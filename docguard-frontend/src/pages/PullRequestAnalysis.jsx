import { useState } from "react";
import { Link } from "react-router-dom";
import { GitPullRequest } from "lucide-react";

import { useWorkflow } from "../workflow-context";
import { analyzePullRequest, getApiErrorMessage } from "../services/api";

import "./PullRequestAnalysis.css";

const changeGroups = [
  ["sourceChanges", "Source changes"],
  ["documentationChanges", "Documentation changes"],
  ["binaryChanges", "Binary changes"],
  ["otherChanges", "Other changes"]
];

function count(value) {
  return Number.isSafeInteger(value) ? value : 0;
}

const PullRequestAnalysis = () => {
  const { pullRequests, savePullRequest } = useWorkflow();
  const [pullRequestUrl, setPullRequestUrl] = useState("");
  const [result, setResult] = useState(pullRequests[0] ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    if (!pullRequestUrl.trim()) {
      setError("Enter a full GitHub pull request URL.");
      return;
    }

    setIsLoading(true);
    try {
      const response = await analyzePullRequest(pullRequestUrl.trim());
      if (!response?.pullRequest || !response?.changeContext || !response?.driftAnalysis) {
        throw new Error("The backend returned incomplete pull request analysis.");
      }
      setResult(response);
      savePullRequest(response);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="page pr-page">
      <header className="page-head">
        <div>
          <h1>Pull request changes</h1>
          <p>Compare changed source files with repository documentation at the pull request head revision.</p>
        </div>
      </header>

      <form onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span>GitHub pull request URL</span>
          <div className="input">
            <GitPullRequest size={16} />
            <input
              type="url"
              required
              placeholder="https://github.com/owner/repository/pull/123"
              value={pullRequestUrl}
              onChange={(event) => setPullRequestUrl(event.target.value)}
              aria-required="true"
            />
          </div>
          <small>Only public GitHub pull requests are supported. GitHub must provide a patch for each source file to analyze it.</small>
        </label>

        {error && <div className="form-error" role="alert">{error}</div>}
        <button type="submit" className="btn" disabled={isLoading}>
          {isLoading ? "Analyzing pull request…" : "Analyze pull request"}
        </button>
      </form>

      <aside className="pr-capability-note" role="note">
        Verified findings use the engine's deterministic evidence rules. Model-only suggestions are shown separately as unverified. Repository snapshot analysis remains available in the <Link to="/repositories">repository analysis workflow</Link>.
      </aside>

      {result && (
        <section className="pr-result" aria-live="polite">
          <header className="page-head">
            <div>
              <h2>
                <a href={result.pullRequest.url} target="_blank" rel="noreferrer">
                  {result.source?.owner}/{result.source?.repository} #{result.pullRequest.number}: {result.pullRequest.title}
                </a>
              </h2>
              <p>
                {result.pullRequest.head?.branch ?? "Unknown head"} into {result.pullRequest.base?.branch ?? "Unknown base"} · {result.pullRequest.state ?? "unknown"}
              </p>
            </div>
          </header>

          <dl className="summary">
            <div><dt>Files changed</dt><dd>{count(result.changeContext.summary?.totalFiles)}</dd></div>
            <div><dt>Source files</dt><dd>{count(result.changeContext.summary?.sourceFiles)}</dd></div>
            <div><dt>Documentation files</dt><dd>{count(result.changeContext.summary?.documentationFiles)}</dd></div>
          </dl>

          {result.driftAnalysis && (
            <section className="pr-drift-analysis" aria-live="polite">
              <h2>Verified documentation drift</h2>
              <p>
                Compared {count(result.driftAnalysis.filesAnalyzed)} source file(s) with documentation at commit{" "}
                <code>{result.driftAnalysis.documentationRef?.slice(0, 12) ?? "unavailable"}</code>.
              </p>
              {result.driftAnalysis.findings?.length ? (
                <ul>
                  {result.driftAnalysis.findings.map((finding) => (
                    <li key={finding.id}>
                      <strong>
                        {finding.documentation?.file ?? "Documentation"}{Number.isSafeInteger(finding.documentation?.line)
                          ? `:${finding.documentation.line}`
                          : ""}
                        {Number.isSafeInteger(finding.documentation?.pageNumber)
                          ? ` · page ${finding.documentation.pageNumber}`
                          : ""}
                      </strong>
                      <p>{finding.sentence ?? finding.documentation?.sentence}</p>
                      <p>{finding.reason}</p>
                      {finding.codeEvidence && (
                        <code>
                          {finding.codeEvidence.file}:{finding.codeEvidence.line ?? "line unavailable"} · {finding.codeEvidence.changeType}: {finding.codeEvidence.text}
                        </code>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No deterministic drift findings were verified.</p>
              )}

              <h3>Unverified model suggestions ({count(result.driftAnalysis.suggestions?.length)})</h3>
              {result.driftAnalysis.suggestions?.length ? (
                <ul>
                  {result.driftAnalysis.suggestions.map((suggestion) => (
                    <li key={suggestion.id}>
                      <strong>{suggestion.documentation?.file ?? "Documentation"}</strong>
                      <p>{suggestion.sentence ?? suggestion.documentation?.sentence}</p>
                      <p>{suggestion.reason}</p>
                      <small>Requires human verification; this is not a confirmed finding.</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No unverified model suggestions were returned.</p>
              )}

              {result.driftAnalysis.filesSkipped?.length > 0 && (
                <>
                  <h3>Source files not analyzed</h3>
                  <ul>
                    {result.driftAnalysis.filesSkipped.map((file) => (
                      <li key={`${file.path}-${file.reason}`}><code>{file.path}</code>: {file.reason}</li>
                    ))}
                  </ul>
                </>
              )}
              {result.driftAnalysis.diagnostics?.files?.filter((file) => file.model?.status !== "response-received").map((file) => (
                <p key={`diagnostic-${file.file}`}>
                  Model status for <code>{file.file}</code>: {file.model?.status ?? "unknown"}
                  {file.model?.detail ? ` — ${file.model.detail}` : ""}
                </p>
              ))}
            </section>
          )}

          {changeGroups.map(([key, title]) => {
            const changes = Array.isArray(result.changeContext[key]) ? result.changeContext[key] : [];
            return (
              <section className="pr-change-group" key={key}>
                <h3>{title} <span className="muted">({changes.length})</span></h3>
                {changes.length === 0 ? (
                  <p className="muted">No {title.toLowerCase()}.</p>
                ) : (
                  <ul>
                    {changes.map((change) => (
                      <li key={`${key}-${change.path}`}>
                        <div>
                          <code>{change.path}</code>
                          <span className="muted"> · {change.status ?? "changed"}</span>
                          {change.originalPath && <div className="muted">Renamed from {change.originalPath}</div>}
                        </div>
                        {typeof change.patch === "string" && (
                          <details>
                            <summary>Show patch</summary>
                            <pre><code>{change.patch}</code></pre>
                          </details>
                        )}
                        {change.patchStatus && change.patchStatus !== "available" && (
                          <span className="muted">Patch unavailable: {change.patchUnavailableReason ?? change.patchStatus}</span>
                        )}
                        {change.patchStatus === "available" && typeof change.patch !== "string" && (
                          <span className="muted">Patch data is not retained between page loads; fetch the pull request again to view it.</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </section>
      )}
    </div>
  );
};

export default PullRequestAnalysis;
