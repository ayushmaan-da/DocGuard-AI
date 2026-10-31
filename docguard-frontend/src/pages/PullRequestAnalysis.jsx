import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  GitBranch,
  GitPullRequest,
  FileText,
  UploadCloud,
  X,
  ArrowRight,
  ShieldCheck,
  FolderGit2
} from "lucide-react";

import "./PullRequestAnalysis.css";

const PullRequestAnalysis = () => {
  const navigate = useNavigate();           
  const [repoUrl, setRepoUrl] = useState("");
  const [prInput, setPrInput] = useState("");
  const [documentation, setDocumentation] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");

  // Validate GitHub repository URL
  const isValidRepoUrl = (url) => {
    return /^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(url.trim());
  };

  // Handle documentation upload
  const handleFileChange = (event) => {
    const file = event.target.files[0];

    if (!file) return;

    const allowedExtensions = ["md", "mdx", "pdf", "txt"];

    const extension = file.name.split(".").pop().toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      setError("Please upload a Markdown, PDF, or TXT file.");
      return;
    }

    setError("");
    setDocumentation(file);
  };

  // Remove uploaded documentation
  const removeFile = () => {
    setDocumentation(null);
  };

  // Handle form submission
  const handleSubmit = (event) => {
    event.preventDefault();

    setError("");

    if (!isValidRepoUrl(repoUrl)) {
      setError("Please enter a valid GitHub repository URL.");
      return;
    }

    if (!prInput.trim()) {
      setError("Please enter a Pull Request URL or number.");
      return;
    }

    setIsAnalyzing(true);

    // Temporary frontend simulation.
    // We will replace this with the backend API later.

    setTimeout(() => {
      console.log({
        repositoryUrl: repoUrl,
        pullRequest: prInput,
        documentation: documentation
          ? documentation.name
          : "README.md"
      });

      setIsAnalyzing(false);

      navigate("/analysis-results");
    }, 1500);
  };

  return (

    <div className="analysis-page">

      {/* Page Heading */}

      <div className="analysis-heading">

        <div>
          <p className="eyebrow">DOCUMENTATION ANALYSIS</p>

          <h1>Analyze Pull Request</h1>

          <p>
            Connect your GitHub repository and identify documentation drift
            before it reaches production.
          </p>
        </div>

        <div className="secure-indicator">
          <ShieldCheck size={17} />
          Secure Analysis
        </div>

      </div>


      <form onSubmit={handleSubmit}>

        {/* Repository Section */}

        <section className="form-section">

          <div className="form-section-heading">

            <div className="form-icon purple-bg">
              <GitBranch size={21} />
            </div>

            <div>
              <h2>Repository Information</h2>
              <p>Provide the GitHub repository you want to analyze.</p>
            </div>

          </div>

          <label htmlFor="repoUrl">
            GitHub Repository URL <span>*</span>
          </label>

          <div className="input-wrapper">

            <GitBranch size={19} />

            <input
              id="repoUrl"
              type="url"
              placeholder="https://github.com/owner/repository"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              required
            />

          </div>

          <p className="input-hint">
            Example: https://github.com/facebook/react
          </p>

        </section>


        {/* Pull Request Section */}

        <section className="form-section">

          <div className="form-section-heading">

            <div className="form-icon blue-bg">
              <GitPullRequest size={21} />
            </div>

            <div>
              <h2>Pull Request Details</h2>
              <p>Select the pull request whose changes need analysis.</p>
            </div>

          </div>

          <label htmlFor="prInput">
            Pull Request URL or Number <span>*</span>
          </label>

          <div className="input-wrapper">

            <GitPullRequest size={19} />

            <input
              id="prInput"
              type="text"
              placeholder="https://github.com/owner/repo/pull/123 or #123"
              value={prInput}
              onChange={(e) => setPrInput(e.target.value)}
              required
            />

          </div>

          <p className="input-hint">
            Enter a GitHub Pull Request URL or its number.
          </p>

        </section>


        {/* Documentation Section */}

        <section className="form-section">

          <div className="form-section-heading">

            <div className="form-icon orange-bg">
              <FileText size={21} />
            </div>

            <div>
              <h2>Documentation Source</h2>
              <p>Upload documentation associated with your repository.</p>
            </div>

          </div>


          {!documentation ? (

            <label className="upload-area" htmlFor="documentation">

              <input
                id="documentation"
                type="file"
                accept=".md,.mdx,.pdf,.txt"
                onChange={handleFileChange}
                hidden
              />

              <UploadCloud size={35} />

              <h3>Upload your documentation</h3>

              <p>
                Drag your file here or <strong>browse files</strong>
              </p>

              <span>Supported formats: MD, MDX, PDF, TXT</span>

            </label>

          ) : (

            <div className="uploaded-file">

              <div className="uploaded-file-icon">
                <FileText size={23} />
              </div>

              <div className="uploaded-file-info">
                <strong>{documentation.name}</strong>
                <span>
                  {(documentation.size / 1024).toFixed(1)} KB
                </span>
              </div>

              <button
                type="button"
                onClick={removeFile}
                className="remove-file"
              >
                <X size={19} />
              </button>

            </div>

          )}


          <div className="readme-notice">

            <FolderGit2 size={21} />

            <div>
              <strong>
                {documentation
                  ? "Custom documentation selected"
                  : "No documentation? We've got you covered."}
              </strong>

              <p>
                {documentation
                  ? "Your uploaded file will be used as the documentation source."
                  : "If you don't upload documentation, DocGuard will use the repository's README.md automatically."}
              </p>
            </div>

          </div>

        </section>


        {/* Error Message */}

        {error && (
          <div className="form-error">
            {error}
          </div>
        )}


        {/* Submit Section */}

        <section className="submit-section">

          <div>
            <ShieldCheck size={19} />

            <span>
              Your repository will be analyzed for potential documentation drift.
            </span>
          </div>

          <button
            type="submit"
            className="start-analysis-button"
            disabled={isAnalyzing}
          >

            {isAnalyzing ? "Preparing Analysis..." : "Start Analysis"}

            <ArrowRight size={18} />

          </button>

        </section>

      </form>

    </div>

  );
};

export default PullRequestAnalysis;