/**
 * CRM Schema Definitions
 *
 * 11 CRM tables + 2 RAG tables. All created in the same SQLite database
 * used by the NanoClaw engine (via getDatabase() export).
 *
 * Tables:
 *   - crm_people: Sales team members with hierarchy
 *   - crm_accounts: Client accounts (advertisers)
 *   - crm_contacts: People at client accounts
 *   - crm_opportunities: Active deals / renewal pipeline
 *   - crm_interactions: Logged client interactions (calls, meetings, emails)
 *   - crm_quotas: Monthly/quarterly sales quotas per AE
 *   - crm_events: Industry events, conferences, deadlines
 *   - crm_media_types: Available media products/formats
 *   - crm_proposals: Proposals sent to clients
 *   - crm_tasks_crm: CRM-specific follow-up tasks (distinct from engine scheduled_tasks)
 *   - crm_activity_log: Audit trail of all CRM mutations
 *   - crm_documents: Document metadata for RAG (Phase 7)
 *   - crm_embeddings: Vector embeddings for semantic search (Phase 7)
 */

import type Database from 'better-sqlite3';

export function createCrmSchema(db: Database.Database): void {
  db.exec(`
    -- Sales team hierarchy
    CREATE TABLE IF NOT EXISTS crm_people (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('ae', 'manager', 'director', 'vp')),
      phone TEXT,
      email TEXT,
      manager_id TEXT REFERENCES crm_people(id),
      group_folder TEXT,
      group_jid TEXT,
      team_group_jid TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crm_people_manager ON crm_people(manager_id);
    CREATE INDEX IF NOT EXISTS idx_crm_people_role ON crm_people(role);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_people_group_folder ON crm_people(group_folder) WHERE group_folder IS NOT NULL;

    -- Client accounts (advertisers)
    CREATE TABLE IF NOT EXISTS crm_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      industry TEXT,
      segment TEXT,
      region TEXT,
      owner_id TEXT REFERENCES crm_people(id),
      annual_revenue REAL,
      status TEXT DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crm_accounts_owner ON crm_accounts(owner_id);

    -- Contacts at client accounts
    CREATE TABLE IF NOT EXISTS crm_contacts (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES crm_accounts(id),
      name TEXT NOT NULL,
      title TEXT,
      email TEXT,
      phone TEXT,
      is_decision_maker INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crm_contacts_account ON crm_contacts(account_id);

    -- Opportunities (deals / renewals)
    CREATE TABLE IF NOT EXISTS crm_opportunities (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES crm_accounts(id),
      owner_id TEXT NOT NULL REFERENCES crm_people(id),
      name TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'prospecting' CHECK(stage IN ('prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost')),
      amount REAL,
      currency TEXT DEFAULT 'MXN',
      close_date TEXT,
      probability INTEGER,
      media_type TEXT,
      campaign_start TEXT,
      campaign_end TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crm_opps_owner ON crm_opportunities(owner_id);
    CREATE INDEX IF NOT EXISTS idx_crm_opps_account ON crm_opportunities(account_id);
    CREATE INDEX IF NOT EXISTS idx_crm_opps_stage ON crm_opportunities(stage);
    CREATE INDEX IF NOT EXISTS idx_crm_opps_owner_stage ON crm_opportunities(owner_id, stage);

    -- Logged client interactions
    CREATE TABLE IF NOT EXISTS crm_interactions (
      id TEXT PRIMARY KEY,
      account_id TEXT REFERENCES crm_accounts(id),
      contact_id TEXT REFERENCES crm_contacts(id),
      opportunity_id TEXT REFERENCES crm_opportunities(id),
      person_id TEXT NOT NULL REFERENCES crm_people(id),
      type TEXT NOT NULL CHECK(type IN ('call', 'meeting', 'email', 'whatsapp', 'event', 'other')),
      summary TEXT NOT NULL,
      outcome TEXT,
      follow_up_date TEXT,
      follow_up_action TEXT,
      logged_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crm_interactions_person ON crm_interactions(person_id);
    CREATE INDEX IF NOT EXISTS idx_crm_interactions_account ON crm_interactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_crm_interactions_logged ON crm_interactions(logged_at);
    CREATE INDEX IF NOT EXISTS idx_crm_interactions_person_logged ON crm_interactions(person_id, logged_at);

    -- Sales quotas
    CREATE TABLE IF NOT EXISTS crm_quotas (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES crm_people(id),
      period_type TEXT NOT NULL CHECK(period_type IN ('monthly', 'quarterly', 'annual')),
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      target_amount REAL NOT NULL,
      currency TEXT DEFAULT 'MXN',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crm_quotas_person ON crm_quotas(person_id);
    CREATE INDEX IF NOT EXISTS idx_crm_quotas_person_period ON crm_quotas(person_id, period_start);

    -- Industry events
    CREATE TABLE IF NOT EXISTS crm_events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      date_start TEXT NOT NULL,
      date_end TEXT,
      location TEXT,
      description TEXT,
      relevant_accounts TEXT,
      created_at TEXT NOT NULL
    );

    -- Media products/formats
    CREATE TABLE IF NOT EXISTS crm_media_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      base_price REAL,
      currency TEXT DEFAULT 'MXN',
      active INTEGER DEFAULT 1
    );

    -- Proposals
    CREATE TABLE IF NOT EXISTS crm_proposals (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL REFERENCES crm_opportunities(id),
      version INTEGER DEFAULT 1,
      status TEXT DEFAULT 'draft',
      total_amount REAL,
      currency TEXT DEFAULT 'MXN',
      sent_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crm_proposals_opp ON crm_proposals(opportunity_id);

    -- CRM follow-up tasks
    CREATE TABLE IF NOT EXISTS crm_tasks_crm (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES crm_people(id),
      account_id TEXT REFERENCES crm_accounts(id),
      opportunity_id TEXT REFERENCES crm_opportunities(id),
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_crm_tasks_person ON crm_tasks_crm(person_id);
    CREATE INDEX IF NOT EXISTS idx_crm_tasks_due ON crm_tasks_crm(due_date);
    CREATE INDEX IF NOT EXISTS idx_crm_tasks_person_status ON crm_tasks_crm(person_id, status);

    -- Audit trail
    CREATE TABLE IF NOT EXISTS crm_activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id TEXT REFERENCES crm_people(id),
      group_folder TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crm_activity_log_person ON crm_activity_log(person_id);
    CREATE INDEX IF NOT EXISTS idx_crm_activity_log_created ON crm_activity_log(created_at);

    -- Document metadata for RAG (Phase 7)
    CREATE TABLE IF NOT EXISTS crm_documents (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      doc_type TEXT,
      content_hash TEXT,
      chunk_count INTEGER DEFAULT 0,
      last_synced TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Vector embeddings for semantic search (Phase 7)
    CREATE TABLE IF NOT EXISTS crm_embeddings (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES crm_documents(id),
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crm_embeddings_doc ON crm_embeddings(document_id);
  `);
}
