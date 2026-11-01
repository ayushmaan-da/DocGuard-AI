import { getProjectReference } from '../services/project-reference-service.js';
import { analyzeProjectDocumentation } from '../services/project-analysis-service.js';
import { sendJson } from '../utils/http-response.js';

export async function analyzeProject(request, response, projectId, {
  loadProject = getProjectReference,
  runAnalysis = analyzeProjectDocumentation,
} = {}) {
  request.resume();
  const project = loadProject(projectId);
  const result = await runAnalysis(project);
  sendJson(response, 200, {
    projectId,
    analysis: result.analysis,
  });
}
