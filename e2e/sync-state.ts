/**
 * The sync log's one state row is part of the schema, not seed data: a
 * migration inserts it and every sync read needs it. Keep it out of the
 * truncate, put it back if an older run removed it, and start a fresh epoch.
 */
export const SYNC_STATE_ROW = `INSERT INTO "sync_state" ("id", "stateOid", "databaseOid")
VALUES (1, '"sync_state"'::regclass::oid::bigint,
  (SELECT "oid"::bigint FROM pg_database WHERE "datname" = current_database()))
ON CONFLICT ("id") DO NOTHING`;

/** A new database is reset before its first migration, when the table does not exist yet. */
export const SYNC_STATE_EXISTS = `SELECT to_regclass('public.sync_state') IS NOT NULL AS "exists"`;
