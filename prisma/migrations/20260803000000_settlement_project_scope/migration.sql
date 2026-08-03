-- Project-scoped settlements.
-- Settlements gain an optional projectId so "settle up" acts on the same
-- per-project balance the UI displays. The column is nullable: legacy rows and
-- genuinely project-less (direct/rollup) settlements keep projectId = NULL.
-- Additive nullable column + guarded DDL: non-locking and backward-compatible.

-- ---------------------------------------------------------------------------
-- Section 1: Additive DDL (column + indexes + foreign key)
-- ---------------------------------------------------------------------------

-- 1. Nullable projectId column.
ALTER TABLE "settlement" ADD COLUMN IF NOT EXISTS "projectId" TEXT;

-- 2. Indexes: single-column lookup + the (project, pair) composite used by the
--    scoped balance queries.
CREATE INDEX IF NOT EXISTS "settlement_projectId_idx"
  ON "settlement" ("projectId");
CREATE INDEX IF NOT EXISTS "settlement_project_pair_idx"
  ON "settlement" ("projectId", "fromParticipantType", "fromParticipantId", "toParticipantType", "toParticipantId");

-- 3. Foreign key to project. ON DELETE SET NULL keeps a settlement row intact
--    (it stays a project-less direct/rollup settlement) if its project is deleted.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settlement_projectId_fkey') THEN
    ALTER TABLE "settlement"
      ADD CONSTRAINT "settlement_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Section 2: Legacy backfill (unambiguous attribution only)
-- ---------------------------------------------------------------------------
--
-- Attribute a legacy settlement to a project ONLY when the (from, to) pair
-- shares expenses in EXACTLY ONE project; otherwise leave projectId = NULL.
--
-- Matching is on raw participant identity (paidBy / split_participant). Caveat:
-- it does NOT resolve claim aliases (a claimed shadow and its claiming user are
-- treated as distinct here). That is acceptable: on prod the settlement data is
-- tiny and inert (no FINALIZED/PROPOSED rows counted toward balances), so this
-- backfill is effectively a no-op and no live balance moves.
WITH pair_projects AS (
  SELECT s.id AS settlement_id, st."projectId" AS project_id
  FROM settlement s
  JOIN shared_transaction st ON st."projectId" IS NOT NULL
  WHERE ( (st."paidByType"=s."fromParticipantType" AND st."paidById"=s."fromParticipantId")
          OR EXISTS (SELECT 1 FROM split_participant sp WHERE sp."transactionId"=st.id AND sp."participantType"=s."fromParticipantType" AND sp."participantId"=s."fromParticipantId") )
    AND ( (st."paidByType"=s."toParticipantType" AND st."paidById"=s."toParticipantId")
          OR EXISTS (SELECT 1 FROM split_participant sp WHERE sp."transactionId"=st.id AND sp."participantType"=s."toParticipantType" AND sp."participantId"=s."toParticipantId") )
  GROUP BY s.id, st."projectId"
), unambiguous AS (
  SELECT settlement_id FROM pair_projects GROUP BY settlement_id HAVING COUNT(DISTINCT project_id)=1
)
UPDATE settlement s SET "projectId"=(SELECT project_id FROM pair_projects pp WHERE pp.settlement_id=s.id LIMIT 1)
FROM unambiguous u WHERE s.id=u.settlement_id;
