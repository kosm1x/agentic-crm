/**
 * Hierarchy Helpers
 *
 * Utilities for querying the sales team hierarchy.
 * Used by IPC handlers and access control checks.
 */

import type Database from 'better-sqlite3';
import { getDatabase } from '../../engine/src/db.js';

export interface Person {
  id: string;
  name: string;
  role: 'ae' | 'manager' | 'director' | 'vp';
  phone: string | null;
  email: string | null;
  manager_id: string | null;
  group_folder: string | null;
  group_jid: string | null;
  team_group_jid: string | null;
  active: number;
  created_at: string;
}

function db(): Database.Database {
  return getDatabase();
}

/** Get a person by their group folder (how agents identify themselves). */
export function getPersonByGroupFolder(groupFolder: string): Person | undefined {
  return db()
    .prepare('SELECT * FROM crm_people WHERE group_folder = ? AND active = 1')
    .get(groupFolder) as Person | undefined;
}

/** Get a person by ID. */
export function getPersonById(id: string): Person | undefined {
  return db()
    .prepare('SELECT * FROM crm_people WHERE id = ?')
    .get(id) as Person | undefined;
}

/** Get all direct reports for a manager/director/VP. */
export function getDirectReports(managerId: string): Person[] {
  return db()
    .prepare('SELECT * FROM crm_people WHERE manager_id = ? AND active = 1')
    .all(managerId) as Person[];
}

/** Check if personA is the direct manager of personB. Single-query check. */
export function isManagerOf(managerId: string, reportId: string): boolean {
  const row = db()
    .prepare('SELECT 1 AS ok FROM crm_people WHERE id = ? AND manager_id = ?')
    .get(reportId, managerId) as { ok: number } | undefined;
  return row !== undefined;
}

/** Check if personA is a director over personB (one or two levels up). Single-query check. */
export function isDirectorOf(directorId: string, personId: string): boolean {
  const row = db()
    .prepare(`
      SELECT 1 AS ok FROM crm_people WHERE id = ? AND (
        manager_id = ?
        OR EXISTS (
          SELECT 1 FROM crm_people AS mgr
          WHERE mgr.id = crm_people.manager_id AND mgr.manager_id = ?
        )
      )
    `)
    .get(personId, directorId, directorId) as { ok: number } | undefined;
  return row !== undefined;
}

/** Check if a person is a VP (top of hierarchy). */
export function isVp(personId: string): boolean {
  const row = db()
    .prepare("SELECT 1 AS ok FROM crm_people WHERE id = ? AND role = 'vp'")
    .get(personId) as { ok: number } | undefined;
  return row !== undefined;
}

/** Get all people in a manager's subtree (recursive). Uses a single CTE query. */
export function getSubtree(rootId: string): Person[] {
  return db()
    .prepare(`
      WITH RECURSIVE subtree(id) AS (
        SELECT id FROM crm_people WHERE manager_id = ? AND active = 1
        UNION ALL
        SELECT p.id FROM crm_people p
        JOIN subtree s ON p.manager_id = s.id
        WHERE p.active = 1
      )
      SELECT p.* FROM crm_people p
      JOIN subtree s ON p.id = s.id
    `)
    .all(rootId) as Person[];
}

/** Check if sourceGroup has access to data owned by targetPersonId. */
export function hasAccessTo(sourceGroupFolder: string, targetPersonId: string): boolean {
  const source = getPersonByGroupFolder(sourceGroupFolder);
  if (!source) return false;

  // People can always access their own data
  if (source.id === targetPersonId) return true;

  // Managers can access their direct reports' data
  if (source.role === 'manager') return isManagerOf(source.id, targetPersonId);

  // Directors can access their subtree
  if (source.role === 'director') return isDirectorOf(source.id, targetPersonId);

  // VPs can access everything
  if (source.role === 'vp') return true;

  return false;
}
