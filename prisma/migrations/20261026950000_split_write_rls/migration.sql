-- Fix: any user could insert a share for themselves into ANY expense whose id
-- they knew, and the same pattern was open on the tables the split rules rest on.
--
-- split_participant_access (20260326000000) was one FOR ALL policy whose WITH
-- CHECK began with "this row is my own share". That let a user insert, or move
-- one of their rows onto, a split of an expense they have nothing to do with:
-- the expense then became readable to them (is_split_participant) and their
-- share counted in the creator's balances, with any amount, negative included.
-- Project members, even viewers, could write every split row of the project.
--
-- What each table allows now (all for the app role; the owner connection used by
-- guests, claims, user deletion and the sweeps is not subject to RLS):
--
--   split_participant
--     SELECT  unchanged.
--     INSERT  the expense's creator or a project organizer/editor (the app's
--             assertCanModifyTransaction rule); or the person restoring a share
--             they removed themselves in the last 24 hours (the remove-me
--             undo, which inserts as the removed user before the expense is
--             visible to them again). The proof is a record that a trigger
--             writes when a non-writer deletes their own row, in a table the app
--             role cannot touch; the restore must match its id, expense, user
--             and money columns, and uses it up.
--     UPDATE  writers; or the person a row belongs to, who may change only the
--             review columns (status, verified at, reason, unseen flag, own
--             category), never amounts or where the row sits.
--     DELETE  writers, or the person a row belongs to (remove me).
--   shared_transaction
--     INSERT  by the author, in a project the author is in (restrictive).
--     UPDATE  cannot change the creator, and cannot move the expense into a
--             project the user is not in (trigger).
--   project_participant
--     SELECT  unchanged (open: other policies read it without recursion).
--     INSERT  an owner adds anyone; an editor adds anyone but an owner; a
--             contributor adds a ghost as a contributor; the project's creator
--             joins their new project as its owner.
--     UPDATE  an owner changes anything; an editor changes members below owner
--             and cannot make an owner; anyone else changes only their own
--             routing and analytics switch, never role, dates or place (trigger).
--     DELETE  an owner removes anyone; an editor removes anyone but an owner.
--   audit_log_entry
--     INSERT  only entries in your own name, the system actor's, or (settlement
--             entries) the other party of a payment you are also a party to.

-- ------------------------------------------------------------
-- Helpers. SECURITY DEFINER so a policy can read the other table without
-- recursing through its policy; only the app role may call them.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION project_role(p_project_id TEXT, p_user_id TEXT)
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT pp."role"::text FROM "project_participant" pp
  WHERE pp."projectId" = p_project_id
    AND pp."participantType" = 'user'
    AND pp."participantId" = p_user_id
$$;

CREATE OR REPLACE FUNCTION is_project_creator(p_project_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "project" p
    WHERE p."id" = p_project_id AND p."createdById" = p_user_id
  )
$$;

-- Whether the user may write the split rows of an expense: its creator, or an
-- organizer/editor of its project.
CREATE OR REPLACE FUNCTION can_write_transaction_splits(p_transaction_id TEXT, p_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "shared_transaction" st
    WHERE st."id" = p_transaction_id
      AND (
        (st."createdByType" = 'user' AND st."createdById" = p_user_id)
        OR (
          st."projectId" IS NOT NULL
          AND project_role(st."projectId", p_user_id) IN ('ORGANIZER', 'EDITOR')
        )
      )
  )
$$;

-- The three older helpers get the same search_path.
ALTER FUNCTION is_split_participant(TEXT, TEXT) SET search_path = public, pg_temp;
ALTER FUNCTION is_transaction_owner(TEXT, TEXT) SET search_path = public, pg_temp;
ALTER FUNCTION is_transaction_project_participant(TEXT, TEXT) SET search_path = public, pg_temp;

-- ------------------------------------------------------------
-- Self-removals: what the remove-me undo restores from.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "split_participant_removal" (
  "splitId"            TEXT PRIMARY KEY,
  "transactionId"      TEXT NOT NULL,
  "userId"             TEXT NOT NULL,
  "shareAmount"        DECIMAL(19, 8) NOT NULL,
  "sharePercentage"    DECIMAL(7, 4),
  "shareUnits"         INTEGER,
  "verificationStatus" "VerificationStatus" NOT NULL,
  "removedAt"          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "split_participant_removal_removedAt_idx"
  ON "split_participant_removal" ("removedAt");
ALTER TABLE "split_participant_removal" ENABLE ROW LEVEL SECURITY;
-- Written and read only by the definer functions below.
REVOKE ALL ON "split_participant_removal" FROM PUBLIC;
REVOKE ALL ON "split_participant_removal" FROM retrospend_app;

-- A person who cannot write the expense deleted their own row: remember it for
-- 24 hours. Deletes by a writer, by the owner connection (no user set) and by an
-- expense going away (the row is gone) leave no record.
CREATE OR REPLACE FUNCTION split_participant_record_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid TEXT := current_setting('app.current_user_id', true);
BEGIN
  IF OLD."participantType" = 'user'
     AND uid IS NOT NULL AND uid <> ''
     AND OLD."participantId" = uid
     AND EXISTS (SELECT 1 FROM "shared_transaction" st WHERE st."id" = OLD."transactionId")
     AND NOT can_write_transaction_splits(OLD."transactionId", uid) THEN
    DELETE FROM "split_participant_removal" WHERE "removedAt" < now() - interval '24 hours';
    INSERT INTO "split_participant_removal"
      ("splitId", "transactionId", "userId", "shareAmount", "sharePercentage", "shareUnits", "verificationStatus")
    VALUES
      (OLD."id", OLD."transactionId", uid, OLD."shareAmount", OLD."sharePercentage", OLD."shareUnits", OLD."verificationStatus")
    ON CONFLICT ("splitId") DO UPDATE SET
      "transactionId" = EXCLUDED."transactionId",
      "userId" = EXCLUDED."userId",
      "shareAmount" = EXCLUDED."shareAmount",
      "sharePercentage" = EXCLUDED."sharePercentage",
      "shareUnits" = EXCLUDED."shareUnits",
      "verificationStatus" = EXCLUDED."verificationStatus",
      "removedAt" = now();
  END IF;
  RETURN OLD;
END
$$;

-- A row coming back uses its record up.
CREATE OR REPLACE FUNCTION split_participant_use_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM "split_participant_removal" WHERE "splitId" = NEW."id";
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION has_self_removal_record(
  p_split_id TEXT,
  p_transaction_id TEXT,
  p_user_id TEXT,
  p_amount NUMERIC,
  p_percentage NUMERIC,
  p_units INTEGER,
  p_status "VerificationStatus"
)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "split_participant_removal" r
    WHERE r."splitId" = p_split_id
      AND r."transactionId" = p_transaction_id
      AND r."userId" = p_user_id
      AND r."shareAmount" = p_amount
      AND r."sharePercentage" IS NOT DISTINCT FROM p_percentage
      AND r."shareUnits" IS NOT DISTINCT FROM p_units
      AND r."verificationStatus" = p_status
      AND r."removedAt" > now() - interval '24 hours'
  )
$$;

DROP TRIGGER IF EXISTS split_participant_record_removal ON "split_participant";
CREATE TRIGGER split_participant_record_removal
  BEFORE DELETE ON "split_participant"
  FOR EACH ROW EXECUTE FUNCTION split_participant_record_removal();
DROP TRIGGER IF EXISTS split_participant_use_removal ON "split_participant";
CREATE TRIGGER split_participant_use_removal
  AFTER INSERT ON "split_participant"
  FOR EACH ROW EXECUTE FUNCTION split_participant_use_removal();

-- ------------------------------------------------------------
-- Update guards (triggers, because a policy cannot compare old and new).
-- They bind the app role only; the owner connection is not limited.
-- ------------------------------------------------------------

-- A person who cannot write the expense changes only the review columns of
-- their own share.
CREATE OR REPLACE FUNCTION split_participant_guard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  review TEXT[] := ARRAY['verificationStatus', 'verifiedAt', 'rejectionReason',
                         'hasUnseenChanges', 'categoryId', 'categorySource', 'updatedAt'];
BEGIN
  IF current_user = 'retrospend_app'
     AND NOT can_write_transaction_splits(OLD."transactionId", current_setting('app.current_user_id', true))
     AND (to_jsonb(NEW) - review) IS DISTINCT FROM (to_jsonb(OLD) - review) THEN
    RAISE EXCEPTION 'row-level security: only the people who write this expense can change a share'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS split_participant_guard_update ON "split_participant";
CREATE TRIGGER split_participant_guard_update
  BEFORE UPDATE ON "split_participant"
  FOR EACH ROW EXECUTE FUNCTION split_participant_guard_update();

-- An expense keeps its creator, and only moves into a project its mover is in.
CREATE OR REPLACE FUNCTION shared_transaction_guard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user = 'retrospend_app' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."createdByType" IS DISTINCT FROM OLD."createdByType"
       OR NEW."createdById" IS DISTINCT FROM OLD."createdById" THEN
      RAISE EXCEPTION 'row-level security: an expense keeps its id and creator'
        USING ERRCODE = '42501';
    END IF;
    IF NEW."projectId" IS NOT NULL
       AND NEW."projectId" IS DISTINCT FROM OLD."projectId"
       AND project_role(NEW."projectId", current_setting('app.current_user_id', true)) IS NULL THEN
      RAISE EXCEPTION 'row-level security: an expense moves only into a project you are in'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS shared_transaction_guard_update ON "shared_transaction";
CREATE TRIGGER shared_transaction_guard_update
  BEFORE UPDATE ON "shared_transaction"
  FOR EACH ROW EXECUTE FUNCTION shared_transaction_guard_update();

-- Membership: nobody changes where a row sits; only an owner makes or changes an
-- owner; a member below editor changes only their own routing and analytics.
CREATE OR REPLACE FUNCTION project_participant_guard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  caller TEXT;
  own TEXT[] := ARRAY['excludeFromAnalytics', 'budgetRouting', 'budgetEnvelopeId'];
BEGIN
  IF current_user <> 'retrospend_app' THEN
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
     OR NEW."participantType" IS DISTINCT FROM OLD."participantType"
     OR NEW."participantId" IS DISTINCT FROM OLD."participantId" THEN
    RAISE EXCEPTION 'row-level security: a member keeps their place in a project'
      USING ERRCODE = '42501';
  END IF;
  caller := project_role(OLD."projectId", current_setting('app.current_user_id', true));
  IF caller = 'ORGANIZER' THEN
    RETURN NEW;
  ELSIF caller = 'EDITOR' THEN
    IF OLD."role"::text = 'ORGANIZER' OR NEW."role"::text = 'ORGANIZER' THEN
      RAISE EXCEPTION 'row-level security: only the owner changes an owner'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - own) IS DISTINCT FROM (to_jsonb(OLD) - own) THEN
    RAISE EXCEPTION 'row-level security: you can change only your own routing and analytics'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS project_participant_guard_update ON "project_participant";
CREATE TRIGGER project_participant_guard_update
  BEFORE UPDATE ON "project_participant"
  FOR EACH ROW EXECUTE FUNCTION project_participant_guard_update();

-- ------------------------------------------------------------
-- split_participant policies
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "split_participant_access" ON "split_participant";
DROP POLICY IF EXISTS "split_participant_select" ON "split_participant";
DROP POLICY IF EXISTS "split_participant_insert" ON "split_participant";
DROP POLICY IF EXISTS "split_participant_update" ON "split_participant";
DROP POLICY IF EXISTS "split_participant_delete" ON "split_participant";

CREATE POLICY "split_participant_select" ON "split_participant"
    AS PERMISSIVE FOR SELECT TO retrospend_app
    USING (
      ("participantType" = 'user' AND "participantId" = current_setting('app.current_user_id', true))
      OR is_transaction_owner("transactionId", current_setting('app.current_user_id', true))
      OR is_transaction_project_participant("transactionId", current_setting('app.current_user_id', true))
    );

CREATE POLICY "split_participant_insert" ON "split_participant"
    AS PERMISSIVE FOR INSERT TO retrospend_app
    WITH CHECK (
      can_write_transaction_splits("transactionId", current_setting('app.current_user_id', true))
      OR (
        "participantType" = 'user'
        AND "participantId" = current_setting('app.current_user_id', true)
        AND has_self_removal_record(
          "id", "transactionId", "participantId",
          "shareAmount", "sharePercentage", "shareUnits", "verificationStatus"
        )
      )
    );

-- The own-row branch of WITH CHECK needs the row to stay on an expense the user
-- is already on. The helper reads the statement's snapshot, so for a row moved
-- to another expense it sees no share there and refuses.
CREATE POLICY "split_participant_update" ON "split_participant"
    AS PERMISSIVE FOR UPDATE TO retrospend_app
    USING (
      can_write_transaction_splits("transactionId", current_setting('app.current_user_id', true))
      OR ("participantType" = 'user' AND "participantId" = current_setting('app.current_user_id', true))
    )
    WITH CHECK (
      can_write_transaction_splits("transactionId", current_setting('app.current_user_id', true))
      OR (
        "participantType" = 'user'
        AND "participantId" = current_setting('app.current_user_id', true)
        AND is_split_participant("transactionId", current_setting('app.current_user_id', true))
      )
    );

CREATE POLICY "split_participant_delete" ON "split_participant"
    AS PERMISSIVE FOR DELETE TO retrospend_app
    USING (
      can_write_transaction_splits("transactionId", current_setting('app.current_user_id', true))
      OR ("participantType" = 'user' AND "participantId" = current_setting('app.current_user_id', true))
    );

-- ------------------------------------------------------------
-- shared_transaction: a new expense is created by its author, in a project the
-- author belongs to. Restrictive, so it narrows shared_transaction_access for
-- inserts only. (Updates are guarded by the trigger above.)
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "shared_transaction_insert_author" ON "shared_transaction";
CREATE POLICY "shared_transaction_insert_author" ON "shared_transaction"
    AS RESTRICTIVE FOR INSERT TO retrospend_app
    WITH CHECK (
      "createdByType" = 'user'
      AND "createdById" = current_setting('app.current_user_id', true)
      AND (
        "projectId" IS NULL
        OR project_role("projectId", current_setting('app.current_user_id', true)) IS NOT NULL
      )
    );

-- ------------------------------------------------------------
-- project_participant
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "project_participant_access" ON "project_participant";
DROP POLICY IF EXISTS "project_participant_select" ON "project_participant";
DROP POLICY IF EXISTS "project_participant_insert" ON "project_participant";
DROP POLICY IF EXISTS "project_participant_update" ON "project_participant";
DROP POLICY IF EXISTS "project_participant_delete" ON "project_participant";

-- Open for reads: other policies read this table without recursion.
CREATE POLICY "project_participant_select" ON "project_participant"
    AS PERMISSIVE FOR SELECT TO retrospend_app
    USING (true);

CREATE POLICY "project_participant_insert" ON "project_participant"
    AS PERMISSIVE FOR INSERT TO retrospend_app
    WITH CHECK (
      project_role("projectId", current_setting('app.current_user_id', true)) = 'ORGANIZER'
      OR (
        project_role("projectId", current_setting('app.current_user_id', true)) = 'EDITOR'
        AND "role"::text <> 'ORGANIZER'
      )
      OR (
        project_role("projectId", current_setting('app.current_user_id', true)) = 'CONTRIBUTOR'
        AND "participantType" = 'shadow'
        AND "role"::text = 'CONTRIBUTOR'
      )
      OR (
        "participantType" = 'user'
        AND "participantId" = current_setting('app.current_user_id', true)
        AND "role"::text = 'ORGANIZER'
        AND is_project_creator("projectId", current_setting('app.current_user_id', true))
      )
    );

CREATE POLICY "project_participant_update" ON "project_participant"
    AS PERMISSIVE FOR UPDATE TO retrospend_app
    USING (
      project_role("projectId", current_setting('app.current_user_id', true)) IN ('ORGANIZER', 'EDITOR')
      OR ("participantType" = 'user' AND "participantId" = current_setting('app.current_user_id', true))
    )
    WITH CHECK (
      project_role("projectId", current_setting('app.current_user_id', true)) IN ('ORGANIZER', 'EDITOR')
      OR ("participantType" = 'user' AND "participantId" = current_setting('app.current_user_id', true))
    );

CREATE POLICY "project_participant_delete" ON "project_participant"
    AS PERMISSIVE FOR DELETE TO retrospend_app
    USING (
      project_role("projectId", current_setting('app.current_user_id', true)) = 'ORGANIZER'
      OR (
        project_role("projectId", current_setting('app.current_user_id', true)) = 'EDITOR'
        AND "role"::text <> 'ORGANIZER'
      )
    );

-- ------------------------------------------------------------
-- audit_log_entry: entries in your own name, or the system actor's.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "audit_log_entry_insert" ON "audit_log_entry";
CREATE POLICY "audit_log_entry_insert" ON "audit_log_entry"
    AS PERMISSIVE FOR INSERT TO retrospend_app
    WITH CHECK (
      "actorType" = 'user'
      AND (
        "actorId" IN (current_setting('app.current_user_id', true), '__system__')
        -- Confirming a payment that changes its amount rewrites the rows and
        -- records the rewrite under the person who first recorded them: the
        -- other party of a settlement the user is also a party to.
        OR (
          "targetType" = 'SETTLEMENT'
          AND EXISTS (
            SELECT 1 FROM "settlement" s
            WHERE s."id" = "audit_log_entry"."targetId"
              AND (
                (s."fromParticipantType" = 'user' AND s."fromParticipantId" = current_setting('app.current_user_id', true))
                OR (s."toParticipantType" = 'user' AND s."toParticipantId" = current_setting('app.current_user_id', true))
              )
              AND (
                (s."fromParticipantType" = 'user' AND s."fromParticipantId" = "audit_log_entry"."actorId")
                OR (s."toParticipantType" = 'user' AND s."toParticipantId" = "audit_log_entry"."actorId")
              )
          )
        )
      )
    );

-- ------------------------------------------------------------
-- Function privileges: the app role only.
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION is_split_participant(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_transaction_owner(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_transaction_project_participant(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION project_role(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_project_creator(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION can_write_transaction_splits(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION has_self_removal_record(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, "VerificationStatus") FROM PUBLIC;
REVOKE ALL ON FUNCTION split_participant_record_removal() FROM PUBLIC;
REVOKE ALL ON FUNCTION split_participant_use_removal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_split_participant(TEXT, TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION is_transaction_owner(TEXT, TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION is_transaction_project_participant(TEXT, TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION project_role(TEXT, TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION is_project_creator(TEXT, TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION can_write_transaction_splits(TEXT, TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION has_self_removal_record(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, "VerificationStatus") TO retrospend_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON "split_participant" TO retrospend_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_participant" TO retrospend_app;
