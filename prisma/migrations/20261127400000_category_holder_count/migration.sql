-- How many rows name a category through a foreign key, whoever wrote them.
--
-- Deleting a category sets Expense, RecurringTemplate, SharedTransaction and
-- SplitParticipant rows to no category and removes Budget, EnvelopeCategory
-- and AnalyticsCategoryPreference rows, whatever those rows' security policies
-- let the deleting person read. The undo of a create deletes a category only
-- while nothing names it, so it has to count rows its caller cannot see: a
-- shared expense of a project the caller left, or one a person on a split
-- filed under their own category. A count through the caller's client would
-- miss those and the delete would uncategorize them silently.
--
-- The function answers only for a category the caller owns (the setting the
-- policies read) and only for a holder it knows; anything else is NULL, which
-- the caller treats as "not safe to delete". It returns a number, never a row.
-- The holder ids are the domain's (category-merge/holders.ts, CATEGORY_HOLDERS);
-- a test counts one row per holder through this function and fails when a
-- foreign key to Category is missing here.
--
-- Idempotent (CREATE OR REPLACE, GRANT and REVOKE are repeatable). The function
-- is SECURITY DEFINER with a search_path that ends in pg_temp, and only
-- retrospend_app may execute it.

CREATE OR REPLACE FUNCTION category_holder_count(p_category_id TEXT, p_holder TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  n BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "category"
    WHERE "id" = p_category_id
      AND "userId" = current_setting('app.current_user_id', TRUE)
  ) THEN
    RETURN NULL;
  END IF;
  IF p_holder = 'expense' THEN
    SELECT count(*) INTO n FROM "expense" WHERE "categoryId" = p_category_id;
  ELSIF p_holder = 'template' THEN
    SELECT count(*) INTO n FROM "recurring_template" WHERE "categoryId" = p_category_id;
  ELSIF p_holder = 'sharedTransaction' THEN
    SELECT count(*) INTO n FROM "shared_transaction" WHERE "categoryId" = p_category_id;
  ELSIF p_holder = 'share' THEN
    SELECT count(*) INTO n FROM "split_participant" WHERE "categoryId" = p_category_id;
  ELSIF p_holder = 'budget' THEN
    SELECT count(*) INTO n FROM "budget" WHERE "categoryId" = p_category_id;
  ELSIF p_holder = 'envelopeLink' THEN
    SELECT count(*) INTO n FROM "envelope_category" WHERE "categoryId" = p_category_id;
  ELSIF p_holder = 'preference' THEN
    SELECT count(*) INTO n FROM "analytics_category_preference" WHERE "categoryId" = p_category_id;
  ELSE
    RETURN NULL;
  END IF;
  RETURN n;
END
$$;

REVOKE ALL ON FUNCTION category_holder_count(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION category_holder_count(TEXT, TEXT) TO retrospend_app;
