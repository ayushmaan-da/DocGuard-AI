import { sendJson } from '../utils/http-response.js';

export function getHealth(_request, response) {
  sendJson(response, 200, {
    status: 'ok',
    service: 'docguard-ai-backend',
  });
}
