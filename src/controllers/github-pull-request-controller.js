import { ingestGitHubPullRequest } from '../services/github-pull-request-service.js';
import { readJsonBody } from '../utils/read-json-body.js';
import { sendJson } from '../utils/http-response.js';

export async function createGitHubPullRequestContext(
  request,
  response,
  ingestPullRequest = ingestGitHubPullRequest,
) {
  const input = await readJsonBody(request);
  const result = await ingestPullRequest(input);
  sendJson(response, 200, result);
}
