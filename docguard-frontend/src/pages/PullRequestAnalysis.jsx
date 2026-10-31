import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { GitBranch, GitPullRequest, UploadCloud, FileText, X } from "lucide-react";

import "./PullRequestAnalysis.css";

const allowedExtensions = ["md", "mdx", "pdf", "txt"];

const PullRequestAnalysis = () => {
  const navigate = useNavigate();
  const [repoUrl, setRepoUrl] = useState("");
  const [prInput, setPrInput] = useState("");
  const [documentation, setDocumentation] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");

  const isValidRepoUrl = (url) =>
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(url.trim());

  const acceptFile = (file) => {
    if (!file) return;
    const extension = file.name.split(".").pop().toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      setError("That file type isn't supported. Upload a Markdown, PDF or text file.");
      return;
    }
    setError("");
    setDocumentation(file);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    acceptFile(event.dataTransfer.files[0]);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setError("");

    if (!isValidRepoUrl(repoUrl)) {
      setError("Enter the repository as https://github.com/owner/repository.");
      return;
    }
    if (!prInput.trim()) {
      setError("Enter a pull request URL or number, such as #123.");
      return;
    }

    setIsAnalyzing(true);

    // Frontend simulation. Replace with the backend call later.
    setTimeout(() => {
      console.log({
        repositoryUrl: repoUrl,
        pullRequest: prInput,
        documentation: documentation ? documentation.name : "README.md"
      });
      setIsAnalyzing(false);
      navigate("/analysis-results");
    }, 1500);
  };

  return (
    <div className="page pr-page">
      <header className="page-head">
        <div>
          <h1>Check a pull request</h1>
          <p>
            DocGuard compares what your documentation says with what the changed code does,
            so drift is caught before it ships.
          </p>
        </div>
      </header>

      <form onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span>Repository</span>
          <div className="input">
            <GitBranch size={16} />
            <input
              type="url"
              placeholder="https://github.com/owner/repository"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              aria-required="true"
            />
          </div>
          <small>For example, https://github.com/facebook/react</small>
        </label>

        <label className="field">
          <span>Pull request</span>
          <div className="input">
            <GitPullRequest size={16} />
            <input
              type="text"
              placeholder="#123 or a full pull request URL"
              value={prInput}
              onChange={(e) => setPrInput(e.target.value)}
              aria-required="true"
            />
          </div>
        </label>

        <div className="field">
          <span>Documentation to check against</span>

          {!documentation ? (
            <label
              className={`upload-area ${isDragging ? "dragging" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept=".md,.mdx,.pdf,.txt"
                onChange={(e) => acceptFile(e.target.files[0])}
                className="sr-only"
              />
              <UploadCloud size={22} />
              <strong>Drop a file or browse</strong>
              <small>Markdown, PDF or text. Optional.</small>
            </label>
          ) : (
            <div className="uploaded-file">
              <FileText size={18} />
              <div>
                <strong>{documentation.name}</strong>
                <small>{(documentation.size / 1024).toFixed(1)} KB</small>
              </div>
              <button
                type="button"
                className="remove-file"
                onClick={() => setDocumentation(null)}
                aria-label={`Remove ${documentation.name}`}
              >
                <X size={16} />
              </button>
            </div>
          )}

          <small>
            {documentation
              ? "DocGuard will use this file instead of the repository README."
              : "With no file, DocGuard checks the repository’s README.md."}
          </small>
        </div>

        {error && <div className="form-error" role="alert">{error}</div>}

        <button type="submit" className="btn" disabled={isAnalyzing}>
          {isAnalyzing ? "Checking…" : "Check pull request"}
        </button>
      </form>
    </div>
  );
};

export default PullRequestAnalysis;
