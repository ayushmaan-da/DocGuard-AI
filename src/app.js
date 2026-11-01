import { createServer } from 'node:http';
import { routeApiRequest } from './routes/api-routes.js';
import { HttpError } from './utils/http-error.js';
import { sendJson } from './utils/http-response.js';

async function handleRequest(request, response, options) {
  try {
    const routeHandled = await routeApiRequest(request, response, options);

    if (!routeHandled) {
      sendJson(response, 404, {
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found.',
        },
      });
    }
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    const code = error instanceof HttpError ? error.code : 'INTERNAL_SERVER_ERROR';
    const message = error instanceof HttpError ? error.message : 'Internal server error.';

    if (statusCode === 500) {
      console.error('Unhandled API request error:', error);
    }

    if (response.headersSent) {
      response.destroy(error);
      return;
    }

    sendJson(response, statusCode, { error: { code, message } });
  }
}

export function createApp(options = {}) {
  return createServer((request, response) => {
    void handleRequest(request, response, options);
  });
}
