import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { children, dashboard, localToday } from './dashboard.js';
import { setCompletion } from './chores.js';
import { registerParentApi } from './parent.js';

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}
export function isTrustedLanAddress(ip: string): boolean {
  const address = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (address === '::1' || address === '127.0.0.1') return true;
  const parts = address.split('.');
  if (parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    const [a, b] = parts.map(Number);
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127;
  }
  return /^f[cd][0-9a-f]{2}:/i.test(address);
}
export function registerChoreApi(app: FastifyInstance, db: DatabaseSync): void {
  app.addHook('onRequest', (request, reply, done) => {
    if (request.url.startsWith('/api/') && request.url !== '/api/health' && !isTrustedLanAddress(request.ip)) {
      void reply.code(403).send({ error: 'Household LAN access only' });
      return;
    }
    if (request.url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      // A browser must not be able to mutate the household API from another site.
      // Compare hostnames rather than ports: Vite's local dev proxy uses a separate port.
      const origin = request.headers.origin;
      if (origin) {
        try {
          const parsed = new URL(origin);
          const host = request.headers.host?.split(':')[0]?.toLowerCase();
          if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname.toLowerCase() !== host) {
            void reply.code(403).send({ error: 'Cross-origin mutation denied' });
            return;
          }
        } catch {
          void reply.code(403).send({ error: 'Invalid origin' });
          return;
        }
      }
    }
    done();
  });
  registerParentApi(app, db);
  app.get('/api/children', () => ({ children: children(db) }));
  app.get<{ Querystring: { date?: string; more?: string; window?: string } }>('/api/chores', (request, reply) => {
    const { date, more, window } = request.query;
    if ((date !== undefined && !validDate(date)) || (more !== undefined && more !== 'true' && more !== 'false') || (window !== undefined && window !== 'true')) {
      return reply.code(400).send({ error: 'Invalid date or more parameter' });
    }
    const extraDays = window !== 'true' && more === 'true' ? 21 : 0;
    return dashboard(db, date ?? localToday(), extraDays, window !== 'true');
  });
  app.put<{ Params: { id: string }; Body: { childId?: string | null; completed?: boolean; performedBy?: string | null } }>(
    '/api/chores/:id/completion', (request, reply) => {
      const body = request.body;
      if (!body || typeof body.completed !== 'boolean' ||
          (body.childId !== undefined && body.childId !== null && typeof body.childId !== 'string') ||
          (body.performedBy !== undefined && body.performedBy !== null && typeof body.performedBy !== 'string')) {
        return reply.code(400).send({ error: 'Invalid completion payload' });
      }
      try {
        const changed = setCompletion(db, request.params.id, body.childId ?? null, body.completed, body.performedBy ?? null);
        return { changed, completed: body.completed };
      } catch (error) {
        if (error instanceof Error && /not found|Invalid completion target|Invalid assignee|Performer must/.test(error.message)) {
          return reply.code(404).send({ error: 'Occurrence or assignee not found' });
        }
        throw error;
      }
    },
  );
}
