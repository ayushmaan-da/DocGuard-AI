import { createApp } from './app.js';

function readPort(portValue) {
  if (portValue === undefined || portValue === '') {
    return 3000;
  }

  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  return port;
}

const port = readPort(process.env.PORT);
const server = createApp();

server.on('error', (error) => {
  console.error(`Unable to start the DocGuard AI backend on port ${port}:`, error);
  process.exitCode = 1;
});

server.listen(port, () => {
  console.log(`DocGuard AI backend listening on port ${port}.`);
});
