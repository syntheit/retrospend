-- S3 follow-ups: a grace period for a rotated webhook secret, and the one
-- read a debtor's person export was missing.
--
-- 1. webhook: the secret before the last rotation, kept encrypted and signed
--    with until "previousSecretExpiresAt". Both are NULL unless the owner asked
--    for a grace period when rotating. The table's row policy and grants are
--    unchanged (the owner reads and writes their own rows); they are restated
--    below so this file stands on its own.
--
-- 2. shared_expense_ids_with(type, id): the ids of the expenses the caller and
--    one other person both have a split row on. Outside a project a debtor
--    sees only their own split row (split_participant_select), so the filter
--    "both people have a row" that the person exports used came back empty for
--    exactly the person who owes money. Same shape as shares_expense_with
--    (migration co_participant_reads): the policy stays as it is, nothing but
--    expense ids leaves the table, and the function reads the RLS user itself
--    and takes no user argument, so nobody can ask about two other people.
--    Idempotent and additive.

ALTER TABLE "webhook"
  ADD COLUMN IF NOT EXISTS "previousSecretCipher"    VARCHAR(512),
  ADD COLUMN IF NOT EXISTS "previousSecretExpiresAt" TIMESTAMP(3);

ALTER TABLE "webhook" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "webhook" TO retrospend_app;

CREATE OR REPLACE FUNCTION shared_expense_ids_with(p_other_type TEXT, p_other_id TEXT)
RETURNS TABLE ("transactionId" TEXT)
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT mine."transactionId"
  FROM "split_participant" mine
  JOIN "split_participant" other ON other."transactionId" = mine."transactionId"
  WHERE mine."participantType" = 'user'
    AND mine."participantId" = current_setting('app.current_user_id', true)
    AND other."participantType"::text = p_other_type
    AND other."participantId" = p_other_id
$$;

REVOKE ALL ON FUNCTION shared_expense_ids_with(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shared_expense_ids_with(TEXT, TEXT) TO retrospend_app;
