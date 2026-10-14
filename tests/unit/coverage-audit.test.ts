import { describe, expect, it } from 'vitest';
import { isTrustedLanAddress } from '../../src/server/api.js';

describe('LAN boundary edge cases', () => {
  it.each(['127.99.0.1', '172.16.0.1', '172.31.255.255', 'fc00::1'])('accepts private address %s', address => {
    expect(isTrustedLanAddress(address)).toBe(true);
  });
  it.each(['172.15.0.1', '172.32.0.1', '256.0.0.1', '10.0.0', '10.0.0.1.2', '10.0.0.x', '::ffff:8.8.8.8', 'fe80::1'])('rejects invalid or public address %s', address => {
    expect(isTrustedLanAddress(address)).toBe(false);
  });
});
