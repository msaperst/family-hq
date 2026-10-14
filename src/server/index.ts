import { buildApp } from './app.js';
import { getServerConfig } from './config.js';
import { openDatabase } from './db.js';

const { port, host, serveClient } = getServerConfig(process.env);
const db = openDatabase(process.env.FAMILY_HQ_DB_PATH ?? './data/family-hq.sqlite');
const app = buildApp({ serveClient });
app.addHook('onClose', async () => { db.close(); });
try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
