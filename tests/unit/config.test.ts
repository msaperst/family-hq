import { describe, expect, it } from 'vitest';
import { getServerConfig } from '../../src/server/config';

describe('server configuration', () => {
  it('uses safe local development defaults', () => {
    expect(getServerConfig({})).toEqual({ port: 3080, host: '127.0.0.1', serveClient: false });
  });

  it('honors configured port, host, and production mode', () => {
    expect(getServerConfig({ FAMILY_HQ_PORT: '4321', HOST: '0.0.0.0', NODE_ENV: 'production' }))
      .toEqual({ port: 4321, host: '0.0.0.0', serveClient: true });
  });

  it.each(['0', '-1', '65536', '1.5', 'not-a-port', ''])('rejects invalid port %s', value => {
    expect(() => getServerConfig({ FAMILY_HQ_PORT: value })).toThrow('Invalid FAMILY_HQ_PORT');
  });

  it('does not serve client assets outside production', () => {
    expect(getServerConfig({ NODE_ENV: 'test' }).serveClient).toBe(false);
  });
});
