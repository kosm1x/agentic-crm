/**
 * CRM IPC Handlers Tests
 *
 * Tests focus on security-critical behaviour:
 *   - Access-control enforcement (AE cannot mutate another AE's data)
 *   - Server-side timestamp (agents must not backdate interaction records)
 *   - Input validation (invalid enums, numbers, and dates are silently rejected)
 *
 * Setup: getDatabase() is mocked so the tests run against an in-memory SQLite
 * database, without needing engine dependencies (pino, baileys, etc.) installed.
 */

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCrmSchema } from '../src/schema.js';
import type { IpcDeps } from '../../engine/src/ipc.js';

// ─── Lightweight database mock ────────────────────────────────────────────────
// Vitest loads engine/src/db.ts (and all its transitive deps) when the
// ipc-handlers module is imported. We intercept getDatabase() to return an
// in-memory SQLite DB so that none of the real engine deps (pino, baileys…)
// need to be installed in this workspace.

let testDb: InstanceType<typeof Database>;

vi.mock('../../engine/src/db.js', () => ({
  getDatabase: () => testDb,
  _initTestDatabase: () => {},
}));

const noop = () => {};
const noopLogger = { info: noop, warn: noop, error: noop, debug: noop, fatal: noop, child: () => noopLogger };
vi.mock('../../engine/src/logger.js', () => ({
  logger: noopLogger,
}));

// Import ipc-handlers AFTER the mock is registered
const { processCrmIpc } = await import('../src/ipc-handlers.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Minimal stub — processCrmIpc never calls deps directly for the tested cases
const fakeDeps: IpcDeps = {
  sendMessage: async () => {},
  registeredGroups: () => ({}),
  registerGroup: () => {},
};

const NOW = new Date().toISOString();

function setupDb() {
  testDb = new Database(':memory:');
  createCrmSchema(testDb);

  // Insert two AEs in separate groups
  testDb.prepare(`
    INSERT INTO crm_people (id, name, role, group_folder, active, created_at)
    VALUES ('ae1', 'Alice AE', 'ae', 'ae1', 1, ?)
  `).run(NOW);

  testDb.prepare(`
    INSERT INTO crm_people (id, name, role, group_folder, active, created_at)
    VALUES ('ae2', 'Bob AE', 'ae', 'ae2', 1, ?)
  `).run(NOW);

  // Insert a manager who manages ae1
  testDb.prepare(`
    INSERT INTO crm_people (id, name, role, group_folder, active, created_at)
    VALUES ('mgr1', 'Carol Manager', 'manager', 'mgr1', 1, ?)
  `).run(NOW);
  testDb.prepare(`UPDATE crm_people SET manager_id = 'mgr1' WHERE id = 'ae1'`).run();

  // Insert an account owned by ae1
  testDb.prepare(`
    INSERT INTO crm_accounts (id, name, owner_id, created_at, updated_at)
    VALUES ('acc1', 'Acme Corp', 'ae1', ?, ?)
  `).run(NOW, NOW);

  // Insert an opportunity owned by ae1
  testDb.prepare(`
    INSERT INTO crm_opportunities (id, account_id, owner_id, name, stage, created_at, updated_at)
    VALUES ('opp1', 'acc1', 'ae1', 'Q1 Campaign', 'prospecting', ?, ?)
  `).run(NOW, NOW);
}

// ─── crm_update_opportunity ──────────────────────────────────────────────────

describe('crm_update_opportunity — access control', () => {
  beforeEach(setupDb);

  it('blocks an AE from updating another AE\'s opportunity', async () => {
    await processCrmIpc(
      { type: 'crm_update_opportunity', opportunity_id: 'opp1', stage: 'proposal' },
      'ae2',   // ae2 does not own opp1
      false,
      fakeDeps,
    );

    const row = testDb
      .prepare('SELECT stage FROM crm_opportunities WHERE id = ?')
      .get('opp1') as { stage: string };

    expect(row.stage).toBe('prospecting'); // unchanged
  });

  it('allows an AE to update their own opportunity', async () => {
    await processCrmIpc(
      { type: 'crm_update_opportunity', opportunity_id: 'opp1', stage: 'proposal' },
      'ae1',   // ae1 owns opp1
      false,
      fakeDeps,
    );

    const row = testDb
      .prepare('SELECT stage FROM crm_opportunities WHERE id = ?')
      .get('opp1') as { stage: string };

    expect(row.stage).toBe('proposal');
  });

  it('allows a manager to update a direct report\'s opportunity', async () => {
    await processCrmIpc(
      { type: 'crm_update_opportunity', opportunity_id: 'opp1', stage: 'negotiation' },
      'mgr1',  // mgr1 manages ae1 who owns opp1
      true,
      fakeDeps,
    );

    const row = testDb
      .prepare('SELECT stage FROM crm_opportunities WHERE id = ?')
      .get('opp1') as { stage: string };

    expect(row.stage).toBe('negotiation');
  });
});

// ─── crm_update_opportunity — input validation ───────────────────────────────

describe('crm_update_opportunity — input validation', () => {
  beforeEach(setupDb);

  it('ignores an invalid stage value', async () => {
    await processCrmIpc(
      { type: 'crm_update_opportunity', opportunity_id: 'opp1', stage: 'flying_saucer' },
      'ae1',
      false,
      fakeDeps,
    );

    const row = testDb
      .prepare('SELECT stage FROM crm_opportunities WHERE id = ?')
      .get('opp1') as { stage: string };

    expect(row.stage).toBe('prospecting'); // unchanged
  });

  it('ignores a negative amount', async () => {
    await processCrmIpc(
      { type: 'crm_update_opportunity', opportunity_id: 'opp1', amount: -5000 },
      'ae1',
      false,
      fakeDeps,
    );

    const row = testDb
      .prepare('SELECT amount FROM crm_opportunities WHERE id = ?')
      .get('opp1') as { amount: number | null };

    expect(row.amount).toBeNull();
  });

  it('ignores a probability above 100', async () => {
    await processCrmIpc(
      { type: 'crm_update_opportunity', opportunity_id: 'opp1', probability: 150 },
      'ae1',
      false,
      fakeDeps,
    );

    const row = testDb
      .prepare('SELECT probability FROM crm_opportunities WHERE id = ?')
      .get('opp1') as { probability: number | null };

    expect(row.probability).toBeNull();
  });

  it('ignores an invalid close_date format', async () => {
    await processCrmIpc(
      { type: 'crm_update_opportunity', opportunity_id: 'opp1', close_date: 'next-friday' },
      'ae1',
      false,
      fakeDeps,
    );

    const row = testDb
      .prepare('SELECT close_date FROM crm_opportunities WHERE id = ?')
      .get('opp1') as { close_date: string | null };

    expect(row.close_date).toBeNull();
  });
});

// ─── crm_log_interaction ─────────────────────────────────────────────────────

describe('crm_log_interaction — timestamp integrity', () => {
  beforeEach(setupDb);

  it('uses server-side time and ignores a user-supplied logged_at', async () => {
    const backdatedTimestamp = '2020-01-01T00:00:00.000Z';

    const before = new Date().toISOString();
    await processCrmIpc(
      {
        type: 'crm_log_interaction',
        interaction_type: 'call',
        summary: 'Test call',
        logged_at: backdatedTimestamp, // should be ignored
      },
      'ae1',
      false,
      fakeDeps,
    );
    const after = new Date().toISOString();

    const row = testDb
      .prepare('SELECT logged_at FROM crm_interactions ORDER BY created_at DESC LIMIT 1')
      .get() as { logged_at: string };

    expect(row.logged_at).not.toBe(backdatedTimestamp);
    expect(row.logged_at >= before).toBe(true);
    expect(row.logged_at <= after).toBe(true);
  });
});

describe('crm_log_interaction — input validation', () => {
  beforeEach(setupDb);

  it('falls back to "other" for an unknown interaction_type', async () => {
    await processCrmIpc(
      { type: 'crm_log_interaction', interaction_type: 'smoke_signal', summary: 'Tried smoke' },
      'ae1',
      false,
      fakeDeps,
    );

    const row = testDb
      .prepare('SELECT type FROM crm_interactions ORDER BY created_at DESC LIMIT 1')
      .get() as { type: string };

    expect(row.type).toBe('other');
  });

  it('stores a valid interaction_type unchanged', async () => {
    await processCrmIpc(
      { type: 'crm_log_interaction', interaction_type: 'meeting', summary: 'Lunch meeting' },
      'ae1',
      false,
      fakeDeps,
    );

    const row = testDb
      .prepare('SELECT type FROM crm_interactions ORDER BY created_at DESC LIMIT 1')
      .get() as { type: string };

    expect(row.type).toBe('meeting');
  });

  it('stores null for an invalid follow_up_date', async () => {
    await processCrmIpc(
      {
        type: 'crm_log_interaction',
        interaction_type: 'call',
        summary: 'Quick call',
        follow_up_date: 'next-week',
      },
      'ae1',
      false,
      fakeDeps,
    );

    const row = testDb
      .prepare('SELECT follow_up_date FROM crm_interactions ORDER BY created_at DESC LIMIT 1')
      .get() as { follow_up_date: string | null };

    expect(row.follow_up_date).toBeNull();
  });
});

// ─── unknown type ─────────────────────────────────────────────────────────────

describe('unknown IPC types', () => {
  beforeEach(setupDb);

  it('returns false for unrecognised CRM types', async () => {
    const result = await processCrmIpc(
      { type: 'crm_does_not_exist' },
      'ae1',
      false,
      fakeDeps,
    );
    expect(result).toBe(false);
  });
});

// ─── Audit log ────────────────────────────────────────────────────────────────

describe('audit logging', () => {
  beforeEach(setupDb);

  it('writes audit log on interaction create', async () => {
    await processCrmIpc(
      { type: 'crm_log_interaction', interaction_type: 'call', summary: 'Audit test' },
      'ae1',
      false,
      fakeDeps,
    );

    const log = testDb
      .prepare("SELECT * FROM crm_activity_log WHERE entity_type = 'interaction'")
      .get() as any;

    expect(log).toBeDefined();
    expect(log.action).toBe('create');
    expect(log.person_id).toBe('ae1');
  });

  it('writes audit log on opportunity update', async () => {
    await processCrmIpc(
      { type: 'crm_update_opportunity', opportunity_id: 'opp1', stage: 'proposal' },
      'ae1',
      false,
      fakeDeps,
    );

    const log = testDb
      .prepare("SELECT * FROM crm_activity_log WHERE entity_type = 'opportunity'")
      .get() as any;

    expect(log).toBeDefined();
    expect(log.action).toBe('update');
    expect(log.entity_id).toBe('opp1');
  });

  it('writes audit log on task create', async () => {
    await processCrmIpc(
      { type: 'crm_create_task', title: 'Audit task' },
      'ae1',
      false,
      fakeDeps,
    );

    const log = testDb
      .prepare("SELECT * FROM crm_activity_log WHERE entity_type = 'task'")
      .get() as any;

    expect(log).toBeDefined();
    expect(log.action).toBe('create');
    expect(log.person_id).toBe('ae1');
  });
});

// ─── crm_create_task ──────────────────────────────────────────────────────────

describe('crm_create_task', () => {
  beforeEach(setupDb);

  it('creates task for valid person', async () => {
    await processCrmIpc(
      { type: 'crm_create_task', title: 'Follow up with client', priority: 'high' },
      'ae1',
      false,
      fakeDeps,
    );

    const task = testDb
      .prepare("SELECT * FROM crm_tasks_crm WHERE person_id = 'ae1'")
      .get() as any;

    expect(task).toBeDefined();
    expect(task.title).toBe('Follow up with client');
    expect(task.priority).toBe('high');
    expect(task.status).toBe('pending');
  });

  it('returns true silently when person not found', async () => {
    const result = await processCrmIpc(
      { type: 'crm_create_task', title: 'Ghost task' },
      'nonexistent',
      false,
      fakeDeps,
    );

    expect(result).toBe(true);

    const count = testDb
      .prepare('SELECT COUNT(*) as c FROM crm_tasks_crm')
      .get() as any;
    expect(count.c).toBe(0);
  });
});

// ─── Input safety ─────────────────────────────────────────────────────────────

describe('input type safety', () => {
  beforeEach(setupDb);

  it('rejects non-string notes in opportunity update', async () => {
    await processCrmIpc(
      { type: 'crm_update_opportunity', opportunity_id: 'opp1', notes: 12345 },
      'ae1',
      false,
      fakeDeps,
    );

    const row = testDb
      .prepare('SELECT notes FROM crm_opportunities WHERE id = ?')
      .get('opp1') as { notes: string | null };

    expect(row.notes).toBeNull(); // non-string notes not applied
  });

  it('handles non-string summary safely in interaction log', async () => {
    await processCrmIpc(
      { type: 'crm_log_interaction', interaction_type: 'call', summary: 42 },
      'ae1',
      false,
      fakeDeps,
    );

    const row = testDb
      .prepare('SELECT summary FROM crm_interactions ORDER BY created_at DESC LIMIT 1')
      .get() as { summary: string };

    // asString(42) returns undefined, falls back to ''
    expect(row.summary).toBe('');
  });
});
