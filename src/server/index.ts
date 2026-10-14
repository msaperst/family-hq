import { buildApp } from './app.js';
import { getServerConfig } from './config.js';

const { port, host, serveClient } = getServerConfig(process.env);
const app = buildApp({ serveClient });
try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
