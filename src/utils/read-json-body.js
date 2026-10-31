import { HttpError } from './http-error.js';

const MAX_REQUEST_SIZE = 10 * 1024 * 1024;

export function readJsonBody(request) {
  const contentType = request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    request.resume();
    return Promise.reject(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.'));
  }

  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_SIZE) {
    request.resume();
    return Promise.reject(new HttpError(413, 'REQUEST_TOO_LARGE', 'JSON request body exceeds the 10 MiB limit.'));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let receivedBytes = 0;
    let tooLarge = false;

    function cleanUp() {
      request.off('data', handleData);
      request.off('end', handleEnd);
      request.off('error', handleError);
      request.off('aborted', handleAborted);
    }

    function handleData(chunk) {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_REQUEST_SIZE) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }

      if (!tooLarge) {
        chunks.push(chunk);
      }
    }

    function handleEnd() {
      cleanUp();

      if (tooLarge) {
        reject(new HttpError(413, 'REQUEST_TOO_LARGE', 'JSON request body exceeds the 10 MiB limit.'));
        return;
      }

      try {
        const requestText = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        resolve(JSON.parse(requestText));
      } catch {
        reject(new HttpError(400, 'INVALID_JSON', 'Request body must contain valid UTF-8 JSON.'));
      }
    }

    function handleError() {
      cleanUp();
      reject(new HttpError(400, 'INVALID_REQUEST_BODY', 'Could not read the complete request body.'));
    }

    function handleAborted() {
      cleanUp();
      reject(new HttpError(400, 'INVALID_REQUEST_BODY', 'Request body was interrupted.'));
    }

    request.on('data', handleData);
    request.once('end', handleEnd);
    request.once('error', handleError);
    request.once('aborted', handleAborted);
  });
}
