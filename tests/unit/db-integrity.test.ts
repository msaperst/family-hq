import { describe, expect, it } from 'vitest';
import { assertDatabaseIntegrity } from '../../src/server/db';

describe('database integrity result', () => {
  it('accepts a clean integrity check', () => {
    expect(() => assertDatabaseIntegrity({ integrity_check: 'ok' })).not.toThrow();
  });

  it('rejects SQLite integrity-check failures', () => {
    expect(() => assertDatabaseIntegrity({ integrity_check: '*** in database main ***\\nPage 2 is never used' }))
      .toThrow('SQLite integrity check failed');
  });

  it('does not treat a non-ok result as healthy', () => {
    expect(() => assertDatabaseIntegrity({ integrity_check: 'database disk image is malformed' }))
      .toThrow('SQLite integrity check failed');
  });
});
