import { describe, expect, it } from 'vitest';
import { isTrustedLanAddress } from '../../src/server/api.js';
describe('household network boundary', () => {
  it.each(['127.0.0.1', '::1', '::ffff:192.168.1.10', '192.168.0.4', '10.0.0.1', '172.17.0.2', 'fd12::1'])('accepts trusted address %s', ip => {
    expect(isTrustedLanAddress(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '172.32.0.1', '192.169.1.1', '169.254.0.1', '2001:db8::1', '999.1.1.1'])('rejects untrusted address %s', ip => {
    expect(isTrustedLanAddress(ip)).toBe(false);
  });
});
