import { ingestGitHubRepository } from '../services/github-repository-service.js';
import { storeProjectReference } from '../services/project-reference-service.js';
import { readJsonBody } from '../utils/read-json-body.js';
import { sendJson } from '../utils/http-response.js';

export async function createGitHubProject(
  request,
  response,
  ingestRepository = ingestGitHubRepository,
  saveProject = storeProjectReference,
) {
  const input = await readJsonBody(request);
  const project = await ingestRepository(input);
  const projectReference = saveProject(project);

  sendJson(response, 201, { ...project, ...projectReference });
}
