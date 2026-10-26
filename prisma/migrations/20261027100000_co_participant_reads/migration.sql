-- Two reads a debtor could not make: "do I share an expense with this person"
-- and "who do I split with most often".
--
-- Outside a project, a debtor sees only their own row of a split
-- (split_participant_select: own row, or the expense's payer/creator, or a
-- project member). The payer's row and the other debtors' rows are hidden, so
-- a relationship check ("both of us have a split row on one expense") and a
-- co-participant count came back empty for exactly the person who owes money.
--
-- The policy stays as it is: widening SELECT would hand a debtor the other
-- people's share amounts. These two helpers answer only what the callers need
-- and nothing else leaves the table:
--
--   shares_expense_with(type, id)   one boolean: is there an expense where the
--                                   caller and that person both have a row
--   co_participant_counts(limit)    for each person who has a row on an expense
--                                   the caller is on: their ref and how many
--                                   such expenses (no amounts, notes or dates)
--
-- Both are bound to the caller: they read app.current_user_id themselves and
-- take no user argument, so nobody can ask about two other people. The app
-- role only. Idempotent and additive.

CREATE OR REPLACE FUNCTION shares_expense_with(p_other_type TEXT, p_other_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "split_participant" mine
    JOIN "split_participant" other ON other."transactionId" = mine."transactionId"
    WHERE mine."participantType" = 'user'
      AND mine."participantId" = current_setting('app.current_user_id', true)
      AND other."participantType"::text = p_other_type
      AND other."participantId" = p_other_id
  )
$$;

CREATE OR REPLACE FUNCTION co_participant_counts(p_limit INTEGER DEFAULT 10)
RETURNS TABLE ("participantType" TEXT, "participantId" TEXT, "sharedCount" INTEGER)
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT other."participantType"::text,
         other."participantId",
         COUNT(DISTINCT other."transactionId")::int
  FROM "split_participant" mine
  JOIN "split_participant" other ON other."transactionId" = mine."transactionId"
  WHERE mine."participantType" = 'user'
    AND mine."participantId" = current_setting('app.current_user_id', true)
    AND other."participantType" IN ('user', 'shadow')
    AND NOT (other."participantType" = 'user' AND other."participantId" = mine."participantId")
  GROUP BY other."participantType", other."participantId"
  ORDER BY COUNT(DISTINCT other."transactionId") DESC, other."participantType", other."participantId"
  LIMIT p_limit
$$;

REVOKE ALL ON FUNCTION shares_expense_with(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION co_participant_counts(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shares_expense_with(TEXT, TEXT) TO retrospend_app;
GRANT EXECUTE ON FUNCTION co_participant_counts(INTEGER) TO retrospend_app;
