import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { createCrmSchema } from '../src/schema.js';

let db: InstanceType<typeof Database>;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createCrmSchema(db);
});

const NOW = '2024-01-01T00:00:00.000Z';

const CRM_TABLES = [
  'crm_people',
  'crm_accounts',
  'crm_contacts',
  'crm_opportunities',
  'crm_interactions',
  'crm_quotas',
  'crm_events',
  'crm_media_types',
  'crm_proposals',
  'crm_tasks_crm',
  'crm_activity_log',
];

const RAG_TABLES = ['crm_documents', 'crm_embeddings'];

describe('CRM Schema', () => {
  it('creates all 11 CRM tables', () => {
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'crm_%' ORDER BY name`,
      )
      .all()
      .map((r: any) => r.name);

    for (const t of CRM_TABLES) {
      expect(tables).toContain(t);
    }
  });

  it('creates 2 RAG tables', () => {
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'crm_%' ORDER BY name`,
      )
      .all()
      .map((r: any) => r.name);

    for (const t of RAG_TABLES) {
      expect(tables).toContain(t);
    }
  });

  it('creates all indexes including composites', () => {
    const indexes = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_crm_%' ORDER BY name`,
      )
      .all()
      .map((r: any) => r.name);

    const expected = [
      'idx_crm_people_manager',
      'idx_crm_people_role',
      'idx_crm_people_group_folder',
      'idx_crm_accounts_owner',
      'idx_crm_contacts_account',
      'idx_crm_opps_owner',
      'idx_crm_opps_account',
      'idx_crm_opps_stage',
      'idx_crm_opps_owner_stage',
      'idx_crm_interactions_person',
      'idx_crm_interactions_account',
      'idx_crm_interactions_logged',
      'idx_crm_interactions_person_logged',
      'idx_crm_quotas_person',
      'idx_crm_quotas_person_period',
      'idx_crm_proposals_opp',
      'idx_crm_tasks_person',
      'idx_crm_tasks_due',
      'idx_crm_tasks_person_status',
      'idx_crm_activity_log_person',
      'idx_crm_activity_log_created',
      'idx_crm_embeddings_doc',
    ];
    for (const idx of expected) {
      expect(indexes).toContain(idx);
    }
  });

  it('enforces foreign key constraints', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO crm_accounts (id, name, owner_id, created_at, updated_at) VALUES ('a1', 'Test', 'nonexistent', ?, ?)`,
        )
        .run(NOW, NOW),
    ).toThrow(/FOREIGN KEY/);
  });

  it('allows basic CRUD on crm_people', () => {
    db.prepare(
      `INSERT INTO crm_people (id, name, role, created_at) VALUES ('p1', 'Test', 'ae', ?)`,
    ).run(NOW);

    const row = db.prepare('SELECT * FROM crm_people WHERE id = ?').get('p1') as any;
    expect(row.name).toBe('Test');
    expect(row.role).toBe('ae');

    db.prepare(`UPDATE crm_people SET name = 'Updated' WHERE id = 'p1'`).run();
    const updated = db.prepare('SELECT name FROM crm_people WHERE id = ?').get('p1') as any;
    expect(updated.name).toBe('Updated');

    db.prepare(`DELETE FROM crm_people WHERE id = 'p1'`).run();
    const deleted = db.prepare('SELECT * FROM crm_people WHERE id = ?').get('p1');
    expect(deleted).toBeUndefined();
  });

  it('allows basic CRUD on crm_accounts', () => {
    db.prepare(
      `INSERT INTO crm_people (id, name, role, created_at) VALUES ('p1', 'Owner', 'ae', ?)`,
    ).run(NOW);
    db.prepare(
      `INSERT INTO crm_accounts (id, name, owner_id, created_at, updated_at) VALUES ('a1', 'Acme', 'p1', ?, ?)`,
    ).run(NOW, NOW);

    const row = db.prepare('SELECT * FROM crm_accounts WHERE id = ?').get('a1') as any;
    expect(row.name).toBe('Acme');

    db.prepare(`UPDATE crm_accounts SET name = 'Acme Corp' WHERE id = 'a1'`).run();
    const updated = db.prepare('SELECT name FROM crm_accounts WHERE id = ?').get('a1') as any;
    expect(updated.name).toBe('Acme Corp');

    db.prepare(`DELETE FROM crm_accounts WHERE id = 'a1'`).run();
    const deleted = db.prepare('SELECT * FROM crm_accounts WHERE id = ?').get('a1');
    expect(deleted).toBeUndefined();
  });

  it('allows basic CRUD on crm_opportunities', () => {
    db.prepare(
      `INSERT INTO crm_people (id, name, role, created_at) VALUES ('p1', 'Owner', 'ae', ?)`,
    ).run(NOW);
    db.prepare(
      `INSERT INTO crm_accounts (id, name, owner_id, created_at, updated_at) VALUES ('a1', 'Acme', 'p1', ?, ?)`,
    ).run(NOW, NOW);
    db.prepare(
      `INSERT INTO crm_opportunities (id, account_id, owner_id, name, stage, created_at, updated_at) VALUES ('o1', 'a1', 'p1', 'Deal', 'prospecting', ?, ?)`,
    ).run(NOW, NOW);

    const row = db.prepare('SELECT * FROM crm_opportunities WHERE id = ?').get('o1') as any;
    expect(row.name).toBe('Deal');
    expect(row.stage).toBe('prospecting');

    db.prepare(`UPDATE crm_opportunities SET stage = 'proposal' WHERE id = 'o1'`).run();
    const updated = db.prepare('SELECT stage FROM crm_opportunities WHERE id = ?').get('o1') as any;
    expect(updated.stage).toBe('proposal');

    db.prepare(`DELETE FROM crm_opportunities WHERE id = 'o1'`).run();
    const deleted = db.prepare('SELECT * FROM crm_opportunities WHERE id = ?').get('o1');
    expect(deleted).toBeUndefined();
  });

  it('allows basic CRUD on crm_interactions', () => {
    db.prepare(
      `INSERT INTO crm_people (id, name, role, created_at) VALUES ('p1', 'Owner', 'ae', ?)`,
    ).run(NOW);
    db.prepare(
      `INSERT INTO crm_interactions (id, person_id, type, summary, logged_at, created_at) VALUES ('i1', 'p1', 'call', 'Test call', ?, ?)`,
    ).run(NOW, NOW);

    const row = db.prepare('SELECT * FROM crm_interactions WHERE id = ?').get('i1') as any;
    expect(row.summary).toBe('Test call');
    expect(row.type).toBe('call');

    db.prepare(`UPDATE crm_interactions SET summary = 'Updated call' WHERE id = 'i1'`).run();
    const updated = db.prepare('SELECT summary FROM crm_interactions WHERE id = ?').get('i1') as any;
    expect(updated.summary).toBe('Updated call');

    db.prepare(`DELETE FROM crm_interactions WHERE id = 'i1'`).run();
    const deleted = db.prepare('SELECT * FROM crm_interactions WHERE id = ?').get('i1');
    expect(deleted).toBeUndefined();
  });

  it('is idempotent (calling twice does not error)', () => {
    expect(() => createCrmSchema(db)).not.toThrow();
  });

  it('rejects invalid role via CHECK constraint', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO crm_people (id, name, role, created_at) VALUES ('bad', 'Bad', 'intern', ?)`,
        )
        .run(NOW),
    ).toThrow(/CHECK/);
  });
});
