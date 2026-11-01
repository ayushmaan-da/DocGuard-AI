import { analyzeGitHubPullRequest } from '../services/github-pull-request-analysis-service.js';
import { readJsonBody } from '../utils/read-json-body.js';
import { sendJson } from '../utils/http-response.js';

export async function createGitHubPullRequestAnalysis(
  request,
  response,
  runAnalysis = analyzeGitHubPullRequest,
) {
  const input = await readJsonBody(request);
  const result = await runAnalysis(input);
  sendJson(response, 200, result);
}
