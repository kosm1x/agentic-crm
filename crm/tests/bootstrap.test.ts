import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let testDb: InstanceType<typeof Database>;

vi.mock('../../engine/src/db.js', () => ({
  getDatabase: () => testDb,
}));

const noop = () => {};
const noopLogger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, child: () => noopLogger };
vi.mock('../../engine/src/logger.js', () => ({
  logger: noopLogger,
}));

const { bootstrapCrm } = await import('../src/bootstrap.js');

describe('bootstrapCrm', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
  });

  it('succeeds on in-memory DB', () => {
    expect(() => bootstrapCrm()).not.toThrow();
  });

  it('is idempotent (calling twice does not error)', () => {
    bootstrapCrm();
    expect(() => bootstrapCrm()).not.toThrow();
  });

  it('creates all 13 CRM tables', () => {
    bootstrapCrm();

    const tables = testDb
      .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name LIKE 'crm_%'")
      .get() as { c: number };

    expect(tables.c).toBe(13);
  });
});
