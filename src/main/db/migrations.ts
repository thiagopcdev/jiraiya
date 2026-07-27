import type Database from 'better-sqlite3'

/**
 * Migrations numeradas. O índice no array + 1 == PRAGMA user_version alvo.
 * Nunca editar uma migration já publicada — sempre adicionar uma nova.
 */
const migrations: string[] = [
  // 001 — schema inicial
  `
  CREATE TABLE workspace (
    id INTEGER PRIMARY KEY,
    site_url TEXT NOT NULL,
    email TEXT NOT NULL,
    account_id TEXT NOT NULL,
    display_name TEXT,
    time_zone TEXT,
    story_points_field_id TEXT,
    sprint_field_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE integration_credential (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    encrypted_value BLOB NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE project (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    jira_id TEXT NOT NULL,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT,
    selected INTEGER NOT NULL DEFAULT 0,
    UNIQUE(workspace_id, jira_id)
  );

  CREATE TABLE board (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    jira_id INTEGER NOT NULL,
    name TEXT,
    type TEXT,
    project_key TEXT,
    UNIQUE(workspace_id, jira_id)
  );

  CREATE TABLE sprint (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    jira_id INTEGER NOT NULL,
    board_jira_id INTEGER,
    name TEXT,
    state TEXT,
    start_date TEXT,
    end_date TEXT,
    complete_date TEXT,
    UNIQUE(workspace_id, jira_id)
  );

  CREATE TABLE issue (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    jira_id TEXT NOT NULL,
    key TEXT NOT NULL,
    project_key TEXT NOT NULL,
    summary TEXT NOT NULL,
    description_text TEXT,
    issue_type TEXT,
    status TEXT,
    status_category TEXT,
    priority TEXT,
    assignee_account_id TEXT,
    assignee_name TEXT,
    reporter_account_id TEXT,
    story_points REAL,
    sprint_jira_id INTEGER,
    labels_json TEXT NOT NULL DEFAULT '[]',
    parent_key TEXT,
    flagged INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    updated_at TEXT,
    resolved_at TEXT,
    last_synced_at TEXT,
    changelog_synced_at TEXT,
    UNIQUE(workspace_id, key)
  );
  CREATE INDEX idx_issue_updated ON issue(workspace_id, updated_at);
  CREATE INDEX idx_issue_status ON issue(workspace_id, status_category);

  CREATE TABLE issue_activity (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    issue_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    actor_account_id TEXT,
    actor_name TEXT,
    field TEXT,
    from_value TEXT,
    to_value TEXT,
    body_text TEXT,
    occurred_at TEXT NOT NULL,
    source_id TEXT NOT NULL,
    UNIQUE(workspace_id, source_id)
  );
  CREATE INDEX idx_activity_time ON issue_activity(workspace_id, occurred_at);
  CREATE INDEX idx_activity_actor ON issue_activity(workspace_id, actor_account_id, occurred_at);

  CREATE TABLE summary (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    period_type TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    template TEXT NOT NULL,
    content_md TEXT NOT NULL,
    generated_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    edited_at TEXT
  );

  CREATE TABLE alert (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    rule_id TEXT NOT NULL,
    issue_key TEXT,
    severity TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT,
    first_detected_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    resolved_at TEXT,
    dismissed_at TEXT,
    UNIQUE(workspace_id, rule_id, issue_key)
  );

  CREATE TABLE sync_state (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    resource TEXT NOT NULL,
    cursor TEXT,
    last_run_at TEXT,
    last_success_at TEXT,
    status TEXT,
    error TEXT,
    UNIQUE(workspace_id, resource)
  );

  CREATE TABLE user_pref (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
  `,
  // 002 — id do custom field "Flagged" (impedimento); 'none' = procurado e ausente
  `
  ALTER TABLE workspace ADD COLUMN flagged_field_id TEXT;
  `,
  // 003 — menções ao usuário do workspace em comentários (inbox de marcações)
  `
  CREATE TABLE mention (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    issue_key TEXT NOT NULL,
    source_id TEXT NOT NULL,
    author_account_id TEXT,
    author_name TEXT,
    excerpt TEXT,
    occurred_at TEXT NOT NULL,
    read_at TEXT,
    UNIQUE(workspace_id, source_id)
  );
  CREATE INDEX idx_mention_time ON mention(workspace_id, occurred_at);
  `,
  // 004: filtros JQL salvos
  `
  CREATE TABLE jql_filter (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    jql TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  `,
  // 005: busca full-text (FTS5) em issues e comentários
  // issue_fts.rowid = issue.id; comment_fts.rowid = issue_activity.id (só kind='comment').
  // Sem external content: triggers fazem delete+insert por rowid para manter sincronia.
  `
  CREATE VIRTUAL TABLE issue_fts USING fts5(summary, description, tokenize='unicode61 remove_diacritics 2');
  CREATE VIRTUAL TABLE comment_fts USING fts5(body, tokenize='unicode61 remove_diacritics 2');

  INSERT INTO issue_fts(rowid, summary, description)
    SELECT id, summary, COALESCE(description_text, '') FROM issue;

  INSERT INTO comment_fts(rowid, body)
    SELECT id, body_text FROM issue_activity WHERE kind = 'comment' AND body_text IS NOT NULL;

  CREATE TRIGGER issue_fts_ai AFTER INSERT ON issue BEGIN
    INSERT INTO issue_fts(rowid, summary, description) VALUES (new.id, new.summary, COALESCE(new.description_text, ''));
  END;
  CREATE TRIGGER issue_fts_au AFTER UPDATE OF summary, description_text ON issue BEGIN
    DELETE FROM issue_fts WHERE rowid = old.id;
    INSERT INTO issue_fts(rowid, summary, description) VALUES (new.id, new.summary, COALESCE(new.description_text, ''));
  END;
  CREATE TRIGGER issue_fts_ad AFTER DELETE ON issue BEGIN
    DELETE FROM issue_fts WHERE rowid = old.id;
  END;

  CREATE TRIGGER comment_fts_ai AFTER INSERT ON issue_activity WHEN new.kind = 'comment' BEGIN
    INSERT INTO comment_fts(rowid, body) VALUES (new.id, COALESCE(new.body_text, ''));
  END;
  CREATE TRIGGER comment_fts_au AFTER UPDATE OF body_text ON issue_activity WHEN new.kind = 'comment' BEGIN
    DELETE FROM comment_fts WHERE rowid = old.id;
    INSERT INTO comment_fts(rowid, body) VALUES (new.id, COALESCE(new.body_text, ''));
  END;
  CREATE TRIGGER comment_fts_ad AFTER DELETE ON issue_activity WHEN old.kind = 'comment' BEGIN
    DELETE FROM comment_fts WHERE rowid = old.id;
  END;
  `,
  // 006: cards seguidos (watch) e notas privadas por card
  `
  CREATE TABLE watch (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    issue_key TEXT NOT NULL,
    last_status TEXT,
    last_activity_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(workspace_id, issue_key)
  );
  CREATE TABLE issue_note (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    issue_key TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(workspace_id, issue_key)
  );
  `,
  // 007: templates de comentário
  `
  CREATE TABLE comment_template (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  `,
  // 008: fila offline de ações
  `
  CREATE TABLE pending_action (
    id INTEGER PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    issue_key TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    local_uuid TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_pending_action_issue ON pending_action(workspace_id, issue_key, id);
  `
]

export function runMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < migrations.length; v++) {
    const apply = db.transaction(() => {
      db.exec(migrations[v])
      db.pragma(`user_version = ${v + 1}`)
    })
    apply()
  }
}

export const MIGRATION_COUNT = migrations.length
