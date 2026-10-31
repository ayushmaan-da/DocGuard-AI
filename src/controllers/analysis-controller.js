import { getProjectReference } from '../services/project-reference-service.js';
import { analyzeWithOllama } from '../services/ollama-analyser-service.js';
import { sendJson } from '../utils/http-response.js';

export async function analyzeProject(request, response, projectId, {
  loadProject = getProjectReference,
  runAnalysis = analyzeWithOllama,
} = {}) {
  request.resume();
  const project = loadProject(projectId);
  const result = await runAnalysis(project);
  sendJson(response, 200, {
    projectId,
    analysis: result.analysis,
  });
}
