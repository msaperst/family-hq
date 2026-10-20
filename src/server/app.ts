import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { HealthResponse } from '../shared/health.js';
import { registerChoreApi } from './api.js';
import { calendarSettings, GoogleCalendar, registerCalendarApi } from './calendar.js';

export function buildApp(options: { serveClient?: boolean; db?: DatabaseSync } = {}) {
  const app = Fastify({ logger: true });
  app.get('/api/health', (): HealthResponse => ({ status: 'ok', service: 'family-hq', revision: process.env.FAMILY_HQ_REVISION || 'development' }));
  if (options.db) {
    registerChoreApi(app, options.db);
    const settings = calendarSettings(process.env);
    registerCalendarApi(app, settings ? new GoogleCalendar(settings) : null);
  }
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
