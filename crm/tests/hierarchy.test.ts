import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCrmSchema } from '../src/schema.js';

let testDb: InstanceType<typeof Database>;

vi.mock('../../engine/src/db.js', () => ({
  getDatabase: () => testDb,
}));

const {
  isManagerOf,
  isDirectorOf,
  isVp,
  getDirectReports,
  getSubtree,
  hasAccessTo,
  getPersonByGroupFolder,
} = await import('../src/hierarchy.js');

const NOW = '2024-01-01T00:00:00.000Z';

/**
 * Test hierarchy:
 *   vp1 (VP)
 *     └── dir1 (Director)
 *           ├── mgr1 (Manager)
 *           │     ├── ae1 (AE, group_folder='ae1')
 *           │     └── ae2 (AE, group_folder='ae2')
 *           └── mgr2 (Manager)
 *                 └── ae3 (AE, group_folder='ae3')
 *   ae4 (AE, no manager, group_folder='ae4') — orphan
 *   ae_inactive (AE, inactive, group_folder='ae_gone')
 */
function setupHierarchy() {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  createCrmSchema(testDb);

  const insert = testDb.prepare(`
    INSERT INTO crm_people (id, name, role, manager_id, group_folder, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run('vp1', 'VP Person', 'vp', null, 'vp1', 1, NOW);
  insert.run('dir1', 'Director Person', 'director', 'vp1', 'dir1', 1, NOW);
  insert.run('mgr1', 'Manager One', 'manager', 'dir1', 'mgr1', 1, NOW);
  insert.run('mgr2', 'Manager Two', 'manager', 'dir1', 'mgr2', 1, NOW);
  insert.run('ae1', 'AE One', 'ae', 'mgr1', 'ae1', 1, NOW);
  insert.run('ae2', 'AE Two', 'ae', 'mgr1', 'ae2', 1, NOW);
  insert.run('ae3', 'AE Three', 'ae', 'mgr2', 'ae3', 1, NOW);
  insert.run('ae4', 'AE Orphan', 'ae', null, 'ae4', 1, NOW);
  insert.run('ae_inactive', 'AE Gone', 'ae', 'mgr1', 'ae_gone', 0, NOW);
}

beforeEach(setupHierarchy);

describe('isManagerOf', () => {
  it('returns true for direct report', () => {
    expect(isManagerOf('mgr1', 'ae1')).toBe(true);
  });

  it('returns false for non-report', () => {
    expect(isManagerOf('mgr1', 'ae3')).toBe(false);
  });
});

describe('isDirectorOf', () => {
  it('returns true for 2-level report', () => {
    expect(isDirectorOf('dir1', 'ae1')).toBe(true);
  });

  it('returns true for direct report of director', () => {
    expect(isDirectorOf('dir1', 'mgr1')).toBe(true);
  });
});

describe('isVp', () => {
  it('identifies VP role', () => {
    expect(isVp('vp1')).toBe(true);
  });

  it('returns false for non-VP', () => {
    expect(isVp('dir1')).toBe(false);
  });
});

describe('getDirectReports', () => {
  it('returns immediate children only', () => {
    const reports = getDirectReports('mgr1');
    const ids = reports.map((r) => r.id).sort();
    expect(ids).toEqual(['ae1', 'ae2']);
  });
});

describe('getSubtree', () => {
  it('returns full recursive tree', () => {
    const tree = getSubtree('dir1');
    const ids = tree.map((r) => r.id).sort();
    expect(ids).toEqual(['ae1', 'ae2', 'ae3', 'mgr1', 'mgr2']);
  });

  it('returns empty for leaf node', () => {
    const tree = getSubtree('ae1');
    expect(tree).toEqual([]);
  });
});

describe('hasAccessTo', () => {
  it('allows self-access for AE', () => {
    expect(hasAccessTo('ae1', 'ae1')).toBe(true);
  });

  it('blocks cross-AE access', () => {
    expect(hasAccessTo('ae1', 'ae2')).toBe(false);
  });

  it('allows manager -> direct report', () => {
    expect(hasAccessTo('mgr1', 'ae1')).toBe(true);
  });

  it('allows director -> 2-level report', () => {
    expect(hasAccessTo('dir1', 'ae1')).toBe(true);
  });

  it('allows VP -> anyone', () => {
    expect(hasAccessTo('vp1', 'ae3')).toBe(true);
  });

  it('returns false for unknown group folder', () => {
    expect(hasAccessTo('nonexistent', 'ae1')).toBe(false);
  });
});

describe('getPersonByGroupFolder', () => {
  it('returns undefined for inactive person', () => {
    expect(getPersonByGroupFolder('ae_gone')).toBeUndefined();
  });
});
