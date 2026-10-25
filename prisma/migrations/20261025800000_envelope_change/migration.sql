-- Envelope edits with an exact undo (budget stream 2B, envelope CRUD).
-- Placeholder timestamp: the orchestrator assigns the final one at merge.
-- envelope_change: one row per setTarget, create, update, merge, archive and
-- confirm-starting-money edit. "before" holds what the edit changed (ids,
-- amounts, flags; no user text), so the undo never trusts a client copy;
-- "previousName" is the one user-text value, in its own column. "id" is the
-- client id of the edit, so a retry is idempotent. "envelopeId" has no foreign
-- key: undoing a create deletes the envelope.
-- RLS: a book table, members only. Rows are kept for good (no DELETE).
-- Additive and idempotent.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EnvelopeChangeKind') THEN
    CREATE TYPE "EnvelopeChangeKind" AS ENUM (
      'SET_TARGET', 'CREATE', 'UPDATE', 'MERGE', 'ARCHIVE', 'CONFIRM_STARTING_MONEY'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "envelope_change" (
  "id"           TEXT                 NOT NULL,
  "bookId"       TEXT                 NOT NULL,
  "kind"         "EnvelopeChangeKind" NOT NULL,
  "envelopeId"   TEXT,
  "previousName" TEXT,
  "before"       JSONB                NOT NULL,
  "actorUserId"  TEXT                 NOT NULL,
  "createdAt"    TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "undoneAt"     TIMESTAMP(3),
  CONSTRAINT "envelope_change_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "envelope_change_bookId_createdAt_idx" ON "envelope_change" ("bookId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'envelope_change_bookId_fkey') THEN
    ALTER TABLE "envelope_change" ADD CONSTRAINT "envelope_change_bookId_fkey"
      FOREIGN KEY ("bookId") REFERENCES "budget_book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON "envelope_change" TO retrospend_app;
REVOKE DELETE ON "envelope_change" FROM retrospend_app;

ALTER TABLE "envelope_change" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS envelope_change_access ON "envelope_change";
CREATE POLICY envelope_change_access ON "envelope_change"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)))
  WITH CHECK (is_budget_member("bookId", current_setting('app.current_user_id', TRUE)));
