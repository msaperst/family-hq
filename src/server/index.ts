import { buildApp } from './app.js';

const port = Number(process.env.FAMILY_HQ_PORT ?? 3080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid FAMILY_HQ_PORT');
const app = buildApp({ serveClient: process.env.NODE_ENV === 'production' });
try {
  await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
