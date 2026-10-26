import type { FastifyInstance } from 'fastify';
import { BlockList, isIP } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import { children, dashboard, localToday } from './dashboard.js';
import { setCompletion, setSkipped } from './chores.js';
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
export function trustedApiPeer(allowed: string | undefined): (ip: string) => boolean {
  if (allowed === undefined) return isTrustedLanAddress;
  const entries = allowed.split(',').map(value => value.trim());
  if (entries.some(value => !value?.includes('/'))) throw new Error('Invalid API allowlist');
  const list = new BlockList();
  for (const value of entries) {
    const [address, bits, ...extra] = value.split('/');
    const family = isIP(address);
    const prefix = Number(bits);
    if (extra.length || !family || !/^\d+$/.test(bits) || prefix > (family === 4 ? 32 : 128))
      throw new Error('Invalid API allowlist');
    list.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  return ip => {
    const peer = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    const family = isIP(peer);
    return family !== 0 && list.check(peer, family === 4 ? 'ipv4' : 'ipv6');
  };
}
/** Exact request Host authorities approved by the deployment's trusted proxy. */
export function allowedApiHosts(config: string | undefined): (host: string | undefined) => boolean {
  if (config === undefined) return () => true;
  const hosts = config.split(',').map(host => host.trim().toLowerCase());
  const valid = /^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])(?::[0-9]{1,5})?$/;
  if (hosts.some(host => !valid.test(host) || host.includes('..'))) {
    throw new Error('Invalid FAMILY_HQ_ALLOWED_HOSTS configuration');
  }
  const allowlist = new Set(hosts);
  return host => typeof host === 'string' && allowlist.has(host.toLowerCase());
}

function mutationOriginError(origin: string | undefined, hostHeader: string | undefined): string | null {
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    // Vite's local dev proxy uses a separate port; preserve hostname comparison.
    const hostname = hostHeader?.split(':')[0]?.toLowerCase();
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.toLowerCase() === hostname
      ? null : 'Cross-origin mutation denied';
  } catch {
    return 'Invalid origin';
  }
}

function apiAccessError(
  url: string, method: string, ip: string,
  headers: { host?: string; origin?: string; 'sec-fetch-site'?: string },
  peerAllowed: (ip: string) => boolean,
  hostAllowed: (host: string | undefined) => boolean,
): string | null {
  const protectedApi = url.startsWith('/api/') && url !== '/api/health';
  if (protectedApi && !hostAllowed(headers.host)) return 'Unrecognized household host';
  if (protectedApi && !peerAllowed(ip)) return 'Household LAN access only';
  // Fetch Metadata protects even read-only household data from cross-site browsers.
  if (protectedApi && headers['sec-fetch-site'] === 'cross-site') return 'Cross-site API access denied';
  if (url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return mutationOriginError(headers.origin, headers.host);
  }
  return null;
}

export function registerChoreApi(app: FastifyInstance, db: DatabaseSync): void {
  const peerAllowed = trustedApiPeer(process.env.FAMILY_HQ_API_ALLOWED_CIDRS);
  const hostAllowed = allowedApiHosts(process.env.FAMILY_HQ_ALLOWED_HOSTS);
  app.addHook('onRequest', (request, reply, done) => {
    const error = apiAccessError(request.url, request.method, request.ip,
      request.headers, peerAllowed, hostAllowed);
    if (error) {
      void reply.code(403).send({ error });
      return;
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
  app.put<{ Params: { id: string }; Body: { childId?: string | null; skipped?: boolean } }>(
    '/api/chores/:id/skip', (request, reply) => {
      const body = request.body;
      if (!body || typeof body.skipped !== 'boolean' ||
        (body.childId !== undefined && body.childId !== null && typeof body.childId !== 'string'))
        return reply.code(400).send({ error: 'Invalid skip payload' });
      try {
        const changed = setSkipped(db, request.params.id, body.childId ?? null, body.skipped);
        return { changed, skipped: body.skipped };
      } catch (error) {
        if (error instanceof Error && /not found|Invalid skip target/.test(error.message))
          return reply.code(404).send({ error: 'Occurrence or assignee not found' });
        if (error instanceof Error && /Completed chore/.test(error.message))
          return reply.code(409).send({ error: error.message });
        throw error;
      }
    },
  );
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
