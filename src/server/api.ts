import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { children, dashboard, localToday } from './dashboard.js';
import { setCompletion } from './chores.js';

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}
export function registerChoreApi(app: FastifyInstance, db: DatabaseSync): void {
  app.get('/api/children', () => ({ children: children(db) }));
  app.get<{ Querystring: { date?: string; more?: string } }>('/api/chores', (request, reply) => {
    const { date, more } = request.query;
    if ((date !== undefined && !validDate(date)) || (more !== undefined && more !== 'true' && more !== 'false')) {
      return reply.code(400).send({ error: 'Invalid date or more parameter' });
    }
    return dashboard(db, date ?? localToday(), more === 'true' ? 21 : 0);
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
