import { getHealth } from '../controllers/health-controller.js';
import { analyzeProject } from '../controllers/analysis-controller.js';
import { createGitHubProject } from '../controllers/github-project-controller.js';
import { createGitHubPullRequestContext } from '../controllers/github-pull-request-controller.js';
import { createGitHubPullRequestAnalysis } from '../controllers/github-pull-request-analysis-controller.js';
import { downloadOriginalPdf, uploadPdfDocumentation } from '../controllers/pdf-document-controller.js';
import { createProject } from '../controllers/project-controller.js';

export async function routeApiRequest(request, response, {
  ingestRepository,
  ingestPullRequest,
  runPullRequestAnalysis,
  saveProject,
  loadProject,
  runAnalysis,
  processPdfUpload,
  getOriginalPdf,
} = {}) {
  const pathname = new URL(request.url, 'http://localhost').pathname;

  if (request.method === 'GET' && pathname === '/api/health') {
    getHealth(request, response);
    return true;
  }

  if (request.method === 'POST' && pathname === '/api/projects/from-github') {
    await createGitHubProject(request, response, ingestRepository, saveProject);
    return true;
  }

  if (request.method === 'POST' && pathname === '/api/pull-requests/from-github') {
    await createGitHubPullRequestContext(request, response, ingestPullRequest);
    return true;
  }

  if (request.method === 'POST' && pathname === '/api/pull-requests/analyze') {
    await createGitHubPullRequestAnalysis(request, response, runPullRequestAnalysis);
    return true;
  }

  if (request.method === 'POST' && pathname === '/api/projects/documents') {
    await uploadPdfDocumentation(request, response, processPdfUpload);
    return true;
  }

  const originalPdfMatch = pathname.match(/^\/api\/documents\/([0-9a-f-]+)\/original$/i);
  if (request.method === 'GET' && originalPdfMatch) {
    downloadOriginalPdf(request, response, originalPdfMatch[1], getOriginalPdf);
    return true;
  }

  if (request.method === 'POST' && pathname === '/api/projects') {
    await createProject(request, response, saveProject);
    return true;
  }

  const analysisMatch = pathname.match(/^\/api\/projects\/([^/]+)\/analyze$/);
  if (request.method === 'POST' && analysisMatch) {
    await analyzeProject(request, response, analysisMatch[1], {
      loadProject,
      runAnalysis,
    });
    return true;
  }

  return false;
}
