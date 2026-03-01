/**
 * CRM Bootstrap
 *
 * Called from engine/src/index.ts after initDatabase().
 * Creates CRM schema tables in the shared SQLite database.
 */

import { getDatabase } from '../../engine/src/db.js';
import { logger } from './logger.js';
import { createCrmSchema } from './schema.js';

const EXPECTED_CRM_TABLES = 13;

export function bootstrapCrm(): void {
  const db = getDatabase();
  try {
    createCrmSchema(db);

    const tables = db
      .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name LIKE 'crm_%'")
      .get() as { c: number };

    if (tables.c < EXPECTED_CRM_TABLES) {
      logger.warn({ expected: EXPECTED_CRM_TABLES, actual: tables.c }, 'CRM table count mismatch');
    }

    logger.info({ tables: tables.c }, 'CRM schema initialized');
  } catch (err) {
    logger.error({ err }, 'CRM bootstrap failed');
    throw err;
  }
}
