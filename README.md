# DocGuard AI

**Automated Documentation Drift Detection**

DocGuard AI is a web application that will help developers find documentation
that may no longer match their source code. The frontend is developed
separately from this backend. The backend can prepare projects and send them
to a separately hosted Ollama model through its analyser integration.

## Problem Statement

**Problem 05 – Automated Documentation Drift Detection**

Documentation can become outdated when developers change source code without
updating the related documentation. Examples include renamed configuration
flags, changed default values, modified API parameters, and removed features
that are still referenced.

## Project Objective

The long-term objective is to identify inconsistencies between source code
and documentation and explain which documentation may need an update.

## Architecture

The intended request flow is:

```text
Frontend → Backend API → Project/File Processing
                         ↓
                  AI Analyser (Ollama)
                         ↓
Frontend ← Backend API ← Analysis Response
```

The backend acts as the bridge between the separately developed frontend and
the AI analyser. Its intended responsibilities are to receive original
source-code files and documentation, validate and organize the submitted
project, preserve original contents and relative paths, distinguish source
code from documentation, send the original material to the analyser, and
forward the analyser's response to the frontend.

The separate AI analyser is responsible for examining the source code and
documentation, detecting changes, and identifying documentation
inconsistencies. The backend must preserve original files without rewriting,
formatting, or summarizing them. Project processing should remain independent
of the input method eventually selected by the frontend team.

Currently, the backend provides:

- Project directory validation and an immediate directory summary.
- Recursive JavaScript and Markdown file discovery.
- Exclusions for common dependency and generated directories.
- Filename-based potential associations between source and documentation.
- A basic HTTP API health check.
- A normalized JSON project-input endpoint that validates paths and classifies
  submitted files without changing their content.
- Public GitHub repository ingestion through the GitHub API. Repository files
  are validated, classified, and kept in memory with their original paths and
  text content. The response exposes original source files separately from
  plain-text documentation prepared for the analyser integration.
- Stateless GitHub Pull Request change-context ingestion using the official
  REST API. PR metadata and bounded file patches are returned with source,
  documentation, binary-extension, and other changes in separate collections.
- Multipart PDF upload and PDF text extraction for uploaded documents and
  PDFs found in GitHub repositories. Original PDFs remain available through
  short-lived in-memory references; extracted text and page numbers are kept
  separately from source code.
- Temporary project references and an Ollama API adapter that sends validated
  source and documentation records, validates the analyser response, and
  returns it to the frontend.

GitHub ingestion is one supported backend input route, but the final frontend
input workflow is not yet agreed. The backend does not yet support ZIP upload
or persistent project storage. The backend does not implement its own
semantic code analysis, documentation drift detection, or AI reasoning; those
responsibilities are delegated to the configured Ollama model.

### Normalized project input

`POST /api/projects` accepts a JSON project representation independent of any
frontend upload or repository transport:

```json
{
  "project": {
    "name": "example-project",
    "files": [
      {
        "path": "src/example.js",
        "content": "const example = true;\n"
      },
      {
        "path": "docs/README.md",
        "content": "# Example project\n"
      }
    ]
  }
}
```

The response preserves each submitted path and content string and adds a
`category`: recognized programming-language extensions are `source`,
recognized documentation extensions and README files are `documentation`,
and other extensions are `other`. Unsafe or duplicate paths and malformed
projects receive a JSON error response. Request bodies are limited to 10 MiB.
Project contents are processed in memory only; they are not saved to disk or
sent to the AI analyser.

### Public GitHub repository input

`POST /api/projects/from-github` accepts a public GitHub repository URL and an
optional branch or ref:

```json
{
  "repositoryUrl": "https://github.com/owner/repository",
  "ref": "main",
  "documentation": [
    {
      "path": "uploaded/guide.md",
      "content": "# User-provided documentation\n"
    }
  ]
}
```

`documentation` is optional and, when provided, must be an array of
`{ "path", "content" }` text files. When no PDF documentation is attached or
found in the repository, supplied text documents take precedence over the
repository README. Otherwise the PDFs are retained as the primary documents
alongside any supplied text. If there are no PDFs or supplied text, the
service uses one readable repository README when available. Root-level README
files are preferred; ties are resolved by case-insensitive relative-path
order, then case-sensitive relative-path order. If no README is available,
the response includes a `DOCUMENTATION_MISSING` warning and an empty
documentation list. Other recognized repository documents remain available
among `project.files` and `analyserInput.documentationFiles`.

When `ref` is omitted, the repository's default branch is used. Only HTTPS
repository URLs on `github.com` are accepted; repository pages, credentials,
query strings, and other hosts are rejected. The backend uses fixed
`api.github.com` endpoints and does not execute repository code or clone it.

The response preserves `project.files` and also provides an `analyserInput`
object with `sourceFiles` and `documentation` as separate fields. Each source
file remains an individual record with its original extension and relative
path. UTF-8 source has unchanged text in `content` and its original bytes in
`originalBytesBase64`; the latter is the base64 encoding of accepted text
file bytes, not a binary-file handoff. Files are never concatenated or
rewritten. Documentation uses `format: "text/plain"` and individual `.txt`
entries, with the original path in `sourcePath` and unchanged UTF-8 text.
Separately uploaded PDFs can be attached to a GitHub ingestion request by
passing the `referenceId` values returned by `POST /api/projects/documents`:

```json
{
  "repositoryUrl": "https://github.com/owner/repository",
  "uploadedDocumentIds": ["returned-reference-id"]
}
```

`analyserInput.originalFiles` contains path, size, mode, Git blob SHA,
classification, retrieval status, and reason metadata, but never raw binary
bytes. Retrieved Git blob bytes are verified against the Git object SHA before
classification. Binary and uncertain file contents are not serialized into
the response. `analyserInput.skippedFiles`, the classification-specific
collections, and `warnings` identify paths that cannot enter the text
handoff. The response also includes the resolved `source.ref` and commit SHA,
a file summary, and `unsupportedAssets`.

Recognized source extensions include JavaScript, TypeScript, Python, Java,
C/C++, C#, Go, Rust, Ruby, PHP, Kotlin, Scala, Swift, Dart, shell, SQL, and
other common source formats. A file enters `sourceFiles` only if its extension
is in the explicit source-code allowlist, its GitHub tree entry is a regular
file, and its content passes signature checks, UTF-8 validation, and control
character inspection. Unknown extensions, including printable UTF-8 text,
are classified `uncertain`, tracked by path/SHA/size, and never included in
the text handoff. Recognized documentation extensions include Markdown,
reStructuredText, AsciiDoc, Org, and plain text. Binary classification uses
GitHub tree/blob metadata, known signatures, UTF-8 validity, and byte/content
inspection. Confirmed binary, uncertain, and non-UTF-8 files are returned as
metadata only; raw binary bytes are not sent in JSON. The service currently
holds fetched bytes transiently for classification and does not persist them.
This is conservative classification, not a guarantee against deliberately
disguised binary data using a recognized source extension. Repository PDFs are
retrieved once through the GitHub blob API, verified against their Git object
SHA, and passed to the same PDF extractor as uploaded documents. They are
excluded from `project.files` and `sourceFiles`; each PDF remains a separate
documentation record with its repository-relative `path`, original filename,
extracted text, page numbers, extraction status, and temporary original-file
reference. Original PDF bytes are never included in JSON responses. Supplied
text documentation with a `.pdf` path is rejected rather than misrepresented
as text.
Common dependency and generated directories (`.git`, `node_modules`, `dist`,
`build`, `coverage`, `.next`, `out`, `target`, `.cache`, and `.turbo`) are
excluded. Symlinks are not followed.

Repository retrieval is bounded by these configurable environment variables:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `GITHUB_MAX_FILES` | 50 | Maximum included repository files |
| `GITHUB_MAX_FILE_BYTES` | 1 MiB | Maximum individual file size |
| `GITHUB_MAX_REPOSITORY_BYTES` | 10 MiB | Maximum combined file size |
| `GITHUB_MAX_API_RESPONSE_BYTES` | 12 MiB | Maximum response size from GitHub |
| `GITHUB_REQUEST_TIMEOUT_MS` | 10,000 | Timeout for each GitHub request |

GitHub unauthenticated API rate limits may also apply. No authentication
credentials are configured or required for public repositories. Project
contents are never written to disk. Project references are held temporarily
in memory; only an explicit analysis request sends prepared text to the
configured Ollama service.
The structured `analyserInput` is the input to the Stage 5 Ollama adapter.
The backend validates and transports its response; semantic analysis and
drift detection are performed by the configured model, not backend code.

The recursive Git Trees REST endpoint is not paginated. If GitHub marks its
tree response as truncated, ingestion fails explicitly with
`REPOSITORY_TREE_TOO_LARGE`; it does not claim a partial tree is complete.
Failures retrieving any listed blob, API rate limits, timeouts, and configured
size limits also return errors instead of a partial-success response.
Intentionally excluded generated/dependency directories, symlinks, submodules,
and files not suitable for text handoff are listed in `analyserInput.skippedFiles`
and may generate a `REPOSITORY_FILES_NOT_IN_TEXT_HANDOFF` warning.

## GitHub Pull Request change context

`POST /api/pull-requests/from-github` accepts a JSON body containing a public
GitHub Pull Request URL. Only direct HTTPS URLs on `github.com` in the
`/{owner}/{repository}/pull/{number}` form are accepted.

```sh
curl -X POST http://localhost:3000/api/pull-requests/from-github \
  -H 'Content-Type: application/json' \
  -d '{"pullRequestUrl":"https://github.com/owner/repository/pull/42"}'
```

The stateless endpoint returns HTTP `200` with the repository identity, PR
title/state and base/head branches and commit SHAs, plus four independent
change collections. A file record contains its current `path`, `originalPath`
for renames, GitHub `status`, path-based `classification`, addition/deletion
counts, and `patch` when available. When a patch is missing or exceeds a
configured limit, `patch` is `null` and `patchStatus` and
`patchUnavailableReason` explain why. For example:

```json
{
  "source": {
    "type": "github-pull-request",
    "owner": "owner",
    "repository": "repository",
    "repositoryUrl": "https://github.com/owner/repository"
  },
  "pullRequest": {
    "number": 42,
    "title": "Update configuration docs",
    "state": "open",
    "url": "https://github.com/owner/repository/pull/42",
    "base": {
      "branch": "main",
      "commitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "head": {
      "branch": "feature/docs",
      "commitSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  },
  "changeContext": {
    "sourceChanges": [
      {
        "path": "src/config.js",
        "originalPath": null,
        "status": "modified",
        "classification": "source",
        "additions": 1,
        "deletions": 1,
        "changes": 2,
        "patch": "@@ -1 +1 @@\n-const timeout = 20;\n+const timeout = 30;\n",
        "patchStatus": "available",
        "patchBytes": 54
      }
    ],
    "documentationChanges": [],
    "binaryChanges": [],
    "otherChanges": [],
    "summary": {
      "totalFiles": 1,
      "sourceFiles": 1,
      "documentationFiles": 0,
      "binaryFiles": 0,
      "otherFiles": 0,
      "patchesAvailable": 1,
      "patchesUnavailable": 0,
      "patchesOmittedByLimit": 0
    }
  }
}
```

The handler uses the GitHub Pull Request detail endpoint and paginates the
official changed-files endpoint (`per_page=100`). It checks that the file
count matches the PR metadata and rejects incomplete responses rather than
returning a partial context. No source project is overwritten or stored, and
this Stage 6B endpoint does not invoke Ollama or perform drift analysis.
Classification follows the existing repository-ingestion extension allowlists;
it is path-based because this endpoint does not download changed-file blobs.
GitHub may omit patches (for example, for binary or large changes); in that
case the reason is reported as unavailable rather than fabricating a diff.
Known binary extensions are grouped separately, but extension classification
does not validate the underlying bytes.

| Variable | Default | Purpose |
| --- | ---: | --- |
| `GITHUB_PR_MAX_FILES` | 100 | Maximum changed files accepted (maximum supported: 300) |
| `GITHUB_PR_MAX_RESPONSE_BYTES` | 12 MiB | Maximum individual GitHub JSON response |
| `GITHUB_PR_MAX_PATCH_BYTES` | 256 KiB | Maximum retained patch for one file |
| `GITHUB_PR_MAX_TOTAL_PATCH_BYTES` | 2 MiB | Maximum total retained patch data |
| `GITHUB_PR_REQUEST_TIMEOUT_MS` | 10,000 | Timeout for each GitHub API request |

By default, the endpoint uses unauthenticated GitHub REST API requests.
Optionally set `GITHUB_TOKEN` in the backend process environment to send a
GitHub Personal Access Token as `Authorization: Bearer ...` for the PR
metadata request and all changed-file pagination requests. This can increase
the applicable GitHub API rate limit. Configure the token through a trusted
environment or secret manager; do not put a real token in source control,
README files, shell command history, or application logs. The backend does
not load `.env` files automatically. `.env.example` contains an empty optional
entry and no credential.

The endpoint only supports public repositories. Supplying a token does not
change that restriction. Requests that exceed file or response limits,
contain unsafe paths, or return malformed/incomplete API data fail with
structured errors. API file-list responses are limited by GitHub to at most
300 files; a PR exceeding that cannot be represented here.

## Planned capabilities

These are future goals and are not implemented yet:

- Accept original project source code and documentation through an input
  workflow agreed with the frontend team; the backend currently supports the
  normalized JSON and public GitHub repository endpoints described above.
- Agree on the frontend's final project-input workflow.
- Support ZIP upload if selected by the team.

## PDF documentation

`POST /api/projects/documents` accepts one or more files as
`multipart/form-data`. Each file must use the `documents` field, have a plain
`.pdf` filename, declare `Content-Type: application/pdf`, and contain a
structurally readable PDF. The backend checks the PDF signature and end
marker, then parses the document; filename and MIME type alone are not trusted.

```sh
curl -X POST http://localhost:3000/api/projects/documents \
  -F 'documents=@guide.pdf;type=application/pdf' \
  -F 'documents=@reference.pdf;type=application/pdf'
```

The JSON response contains `documentation` records with `source: "uploaded"`,
`format: "text/plain"`, `originalFormat: "application/pdf"`, `extractedText`,
per-page `{ "pageNumber", "text" }` entries, and `extractionStatus`. Scanned
PDFs with no selectable text are marked `requires_ocr` and include a
`PDF_OCR_REQUIRED` warning; no OCR is performed. Encrypted, malformed, empty,
oversized, or over-page-limit PDFs receive structured errors.

Each record's `original` metadata includes its size, SHA-256 digest, temporary
`referenceId`, download URL, and expiry time. Use
`GET /api/documents/{referenceId}/original` to retrieve the unchanged PDF
bytes. References are random bearer tokens held only in process memory, expire
after 15 minutes by default, and are lost if the backend restarts. No PDF bytes
are placed in JSON, written to disk, or retained permanently.

Documentation selection for GitHub ingestion is deterministic:

1. Attach uploaded PDF references with `uploadedDocumentIds`; all attached
   uploaded PDFs are included.
2. Include every PDF found in the repository as a separate document. Uploaded
   and repository PDFs are both retained when both exist.
3. If there are no PDFs, use the existing supplied text documentation when
   present; otherwise select the repository README using the Stage 3 ordering.
4. If there is no PDF, supplied text documentation, or README, return a
   `DOCUMENTATION_MISSING` warning.

The `analyserInput.documentation.files` list keeps each PDF independent from
source files and includes page references. The existing
`analyserInput.documentationFiles` field continues to expose ordinary
repository text documentation. PDF extraction preserves the PDF as supplied
and does not summarize or rewrite extracted text. Reading order follows the
PDF.js text-item order; complex layouts may not extract in visual reading
order. Scanned documents require a future OCR stage.

PDF processing limits are configurable:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `PDF_MAX_UPLOAD_FILES` | 5 | Maximum PDFs in one upload |
| `PDF_MAX_REQUEST_BYTES` | 20 MiB | Maximum multipart request size |
| `PDF_MAX_FILE_BYTES` | 10 MiB | Maximum uploaded PDF size |
| `PDF_MAX_PAGES` | 500 | Maximum pages per PDF |
| `PDF_EXTRACTION_TIMEOUT_MS` | 10,000 | Maximum extraction duration |
| `PDF_MAX_EXTRACTED_TEXT_CHARACTERS` | 2 Mi characters | Maximum extracted text per PDF |
| `PDF_MAX_AGGREGATE_TEXT_CHARACTERS` | 10 Mi characters | Maximum extracted text per upload or repository |
| `PDF_MAX_STORED_BYTES` | 50 MiB | Maximum combined original PDF bytes held in memory |
| `PDF_MAX_STORED_DOCUMENTS` | 100 | Maximum active original PDF references |
| `PDF_MAX_STORED_TEXT_CHARACTERS` | 20 Mi characters | Maximum extracted text held with active references |
| `PDF_REFERENCE_TTL_MS` | 900,000 | Lifetime of temporary original-PDF references |

Repository PDFs are also subject to the existing GitHub per-file, aggregate,
file-count, API-response, and request-timeout limits.

## Stage 5: Ollama analyser integration

The project creation endpoints now return a random `projectId` and
`expiresAt`. The project is held in a bounded in-memory reference store so
the frontend does not need to upload its files again for analysis. By default,
references expire after 15 minutes; the store allows at most 100 projects and
50 MiB of prepared source/documentation content. References are lost when the
backend restarts.

Trigger analysis with a bodyless request:

```http
POST /api/projects/{projectId}/analyze
```

```sh
curl -X POST http://localhost:3000/api/projects/PROJECT_ID/analyze
```

The backend sends `POST {OLLAMA_BASE_URL}/api/chat` using Ollama's non-streaming
chat API and JSON Schema response format. The request keeps source files as
individual `{ "path", "content" }` records and documentation as separate
plain-text records with filenames, source metadata, extracted PDF page text,
page references, extraction warnings, and repository metadata (when present).
Binary, uncertain, unsupported content, base64 fields, original PDF bytes,
and temporary download references are not sent to Ollama. The configured
model and Ollama URL are not exposed in the frontend response.

The frontend response is:

```json
{
  "projectId": "temporary-project-reference",
  "analysis": {
    "summary": "The documentation describes a previous default value.",
    "findings": [
      {
        "severity": "medium",
        "title": "Documented default differs from source",
        "explanation": "The source sets the timeout to 30 while the guide says 20.",
        "sourceReferences": [
          { "path": "src/config.js", "startLine": 4, "endLine": 4 }
        ],
        "documentationReferences": [
          { "path": "docs/guide.pdf", "pageNumber": 2, "quote": "timeout is 20" }
        ],
        "recommendation": "Update the guide to describe the current timeout."
      }
    ]
  }
}
```

The validated response contract requires a `summary` string and a `findings`
array. Every finding must contain severity (`critical`, `high`, `medium`,
`low`, or `info`), title, explanation, source references, documentation
references, and recommendation. Reference records require a path and may
include line ranges or a page number and quote. Empty findings are valid; the
backend does not create, revise, or infer findings.

Configure Ollama by copying `.env.example` and setting `OLLAMA_MODEL` to a
model already available to your Ollama service. The application does not
automatically load `.env` files; export the variables in the process
environment before starting the server. `OLLAMA_BASE_URL` defaults to
`http://127.0.0.1:11434`; it must be an HTTP(S) origin without credentials,
path, query, or fragment. Only this administrator-configured URL is used for
outbound requests, redirects are rejected, and no Ollama credentials are
sent. Use only a trusted Ollama service and model.

For example, configure the model and start the backend in the same shell:

```sh
export OLLAMA_MODEL='your-installed-model'
export OLLAMA_BASE_URL='http://127.0.0.1:11434'
npm start
```

The project ID is a temporary bearer reference: anyone who obtains it can
request analysis until it expires. This backend does not currently implement
user authentication or project ownership checks. Keep the API on a trusted
network and avoid exposing project IDs.

| Variable | Default | Purpose |
| --- | ---: | --- |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Configured Ollama service origin |
| `OLLAMA_MODEL` | (required) | Installed Ollama model name |
| `OLLAMA_REQUEST_TIMEOUT_MS` | 120,000 | Maximum Ollama request duration |
| `OLLAMA_MAX_RESPONSE_BYTES` | 2 MiB | Maximum Ollama response body |
| `ANALYSER_MAX_INPUT_BYTES` | 15 MiB | Maximum prepared analysis request |
| `PROJECT_REFERENCE_MAX_COUNT` | 100 | Maximum active prepared projects |
| `PROJECT_REFERENCE_MAX_BYTES` | 50 MiB | Combined prepared project storage limit |
| `PROJECT_REFERENCE_TTL_MS` | 900,000 | Project reference lifetime |

Ollama connection failures, timeouts, unsuccessful HTTP responses, model
errors, malformed JSON, invalid result fields, and oversized outputs return
structured API errors rather than successful-looking empty results. Tests
mock Ollama; a passing test suite does not establish that a live Ollama
service/model is available or that its findings are correct. Semantic result
quality depends on the configured model and is not guaranteed by the backend.

## Requirements

- Node.js 18 or later
- npm

The backend uses Busboy for bounded multipart request parsing and PDF.js for
PDF validation and text extraction, alongside Node.js built-in modules.
Optional PDF.js rendering dependencies are omitted because this backend only
extracts text and does not render PDF pages.

## Installation

```sh
npm install
```

## Start the backend

```sh
npm start
```

The server listens on port `3000` by default. Set `PORT` to use another
available port:

```sh
PORT=4000 npm start
```

## Health check

```http
GET /api/health
```

Example response:

```json
{
  "status": "ok",
  "service": "docguard-ai-backend"
}
```

## Run tests

```sh
npm test
```

The project uses Node.js's built-in test runner.

## Project

- Hackathon: Hacktoberfest 2026 – Hack Day Sonipat
- Team: HACKTOBER_WASTE
- Problem statement: Problem 05 – Automated Documentation Drift Detection

## Team

- Asmit Kumar
- Priyesh Choubey
- Ayushmaan Daksh

## License

This project is licensed under the MIT License.

## Contribution

Contributions will be managed through GitHub Pull Requests.
