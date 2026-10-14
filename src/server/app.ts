import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HealthResponse } from '../shared/health.js';

export function buildApp(options: { serveClient?: boolean } = {}) {
  const app = Fastify({ logger: true });
  app.get('/api/health', async (): Promise<HealthResponse> => ({ status: 'ok', service: 'family-hq' }));
  if (options.serveClient) {
    const root = resolve(process.cwd(), 'dist/client');
    if (!existsSync(resolve(root, 'index.html'))) throw new Error('Built client assets missing');
    void app.register(fastifyStatic, { root, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.includes('.')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not Found' });
    });
  }
  return app;
}
