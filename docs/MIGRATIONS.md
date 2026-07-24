# Workspace Database Migrations

The workspace store is a local **SQLite** database (Node's built-in
`node:sqlite` `DatabaseSync`) that backs the `/api/product?route=workspace/*`
CRUD layer (clients, projects, campaigns, content items, assets, render/publish
jobs, notes, activity log).

> Grounded in [`src/workspace/workspace-store.js`](../src/workspace/workspace-store.js)
> (`migrate`, `listMigrations`, `getCurrentVersion`) and the SQL under
> [`src/workspace/migrations/`](../src/workspace/migrations). This is separate
> from the JSON/Postgres product storage adapter
> (`api/_lib/storage.js`) and from `db/postgres-schema.sql`.

## Where the database lives

`api/product` resolves the path (`resolveWorkspaceDbPath`):

- `HERMEST_WORKSPACE_DB` if set, else
- `<dataRoot>/workspace.db`, where `dataRoot` =
  `HERMEST_DATA_DIR` or `<cwd>/.data/hermest-board` (on Vercel: an **ephemeral**
  `tmpdir`).

The bare `createWorkspaceStore()` default is `:memory:` (used by tests). On
self-host, the durable file is `.data/hermest-board/workspace.db`. See
[`docs/BACKUP_RESTORE.md`](BACKUP_RESTORE.md).

## How migrations apply

On every `createWorkspaceStore(...)`, `migrate()` runs (idempotently):

1. Enable `PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL`.
2. Ensure a `schema_version(version INTEGER PRIMARY KEY, applied_at TEXT)` table.
3. `currentVersion` = max applied version (0 if none).
4. `listMigrations()` reads every `*.sql` file in `src/workspace/migrations/`,
   **sorted by filename**, and parses the version from the leading numeric
   prefix (`0001_…` → `1`).
5. Each migration with `version > currentVersion` is applied via `db.exec(sql)`
   and a `schema_version` row is inserted with an ISO timestamp.

Properties:

- **Forward-only.** There is no down/rollback step. To undo, restore a database
  backup ([`docs/BACKUP_RESTORE.md`](BACKUP_RESTORE.md)).
- **Idempotent to run.** Already-applied versions are skipped; every table uses
  `create table if not exists`, so re-running is safe.
- **Ordering is lexical.** Keep the zero-padded prefix (`0002_…`, `0003_…`) so
  sort order equals apply order.

## Adding a migration

1. Create `src/workspace/migrations/000N_<description>.sql` with the next
   zero-padded version.
2. Use `create table if not exists` / `create index if not exists` and additive,
   Postgres-portable SQL (the schema is written to stay SQLite + Postgres
   compatible). Prefer additive changes; SQLite's `ALTER TABLE` is limited.
3. Run any workspace test/route (`npm run test:workspace`) — the new file is
   picked up automatically and applied once; verify the `schema_version` row.
4. Never edit an already-shipped migration file; add a new one.

## Version 1 — `0001_initial_schema.sql`

Tables (all carry `workspace_id`, `created_at`, `updated_at` where applicable):

| Table | Key columns | FK / cascade |
|-------|-------------|--------------|
| `clients` | `id`, `name`, `status`(active/archived), `owner`, `tags` | — |
| `projects` | `id`, `client_id`, `name`, `status`(active/archived/completed), `due_date` | `client_id → clients` on delete set null |
| `campaigns` | `id`, `project_id`, `name`, `status`(draft/active/completed/cancelled) | `project_id → projects` on delete cascade |
| `content_items` | `id`, `campaign_id`, `name`, `type`(video/article/image/social/other), `status`(draft/in_progress/review/approved/published) | `campaign_id → campaigns` on delete set null |
| `assets` | `id`, `content_item_id`, `name`, `url`, `type` | `content_item_id → content_items` on delete set null |
| `render_jobs` | `id`, `content_item_id`, `status`(queued/running/completed/failed/cancelled), `payload`, `result`, `error` | `content_item_id → content_items` on delete set null |
| `publish_jobs` | `id`, `content_item_id`, `platform`, `status`(same enum), `payload`, `result`, `error` | `content_item_id → content_items` on delete set null |
| `notes` | `id`, `entity_type`(client/project/campaign/content_item), `entity_id`, `content`, `author` | — |
| `activity_log` | `id`, `entity_type`, `entity_id`, `action`, `actor`, `summary`, `timestamp` | — |
| `schema_version` | `version`, `applied_at` | migration bookkeeping |

Indexes: `idx_projects_client`, `idx_campaigns_project`, `idx_content_campaign`,
`idx_activity_workspace`.

`HERMEST_WORKSPACE_MULTI_USER=1` enables multi-user filtering in the store
(single-tenant otherwise).
