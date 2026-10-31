import { processProjectInput } from '../services/project-input-service.js';
import { storeProjectReference } from '../services/project-reference-service.js';
import { readJsonBody } from '../utils/read-json-body.js';
import { sendJson } from '../utils/http-response.js';

export async function createProject(request, response, saveProject = storeProjectReference) {
  const input = await readJsonBody(request);
  const result = processProjectInput(input);
  const projectReference = saveProject(result);

  sendJson(response, 201, { ...result, ...projectReference });
}
