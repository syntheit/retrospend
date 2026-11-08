-- SECURITY DEFINER hygiene (access hardening, PR 3).
--
-- Every SECURITY DEFINER function in schema public ends up with:
--   * no EXECUTE for PUBLIC;
--   * EXECUTE for retrospend_app only when a policy, an invoker trigger or
--     scoped code calls it (the list is app_keeps below);
--   * a search_path that ends in pg_temp, so a temp object cannot shadow a
--     name the function resolves.
--
-- Trigger functions, and the budget_dirty_* helpers they call, run as the
-- table owner whoever fires them, and a trigger's EXECUTE privilege is only
-- checked when the trigger is created. So they need no grant at all.
-- budget_dirty_add, budget_dirty_user and budget_dirty_book_day let a caller
-- mark any user's or any book's budget as dirty, and budget_party_user returns
-- the claimedById of any shadow person. Nothing in the app or in a policy calls
-- them outside those triggers (checked in the catalog and in src), so
-- retrospend_app loses them. settlement_confirmed_by is the same: only the
-- definer settled_entry_ok calls it now, since the old policy that called it
-- directly was replaced in 20261030300000_settlement_followups.
--
-- SECURITY INVOKER functions keep what they have: PUBLIC loses EXECUTE and
-- retrospend_app keeps it where it could execute before (invoker triggers such
-- as account_leg_moves_balance call account_leg_apply as retrospend_app).
-- Extension functions (unaccent) are not touched.
--
-- The helpers that take a user id argument (is_split_participant,
-- is_budget_member and the like) are read-only predicates that the policies
-- call with current_setting('app.current_user_id'). Anyone who can run SQL as
-- retrospend_app can set that setting to any user anyway (see the access
-- hardening plan), so binding them would add nothing and risk the policies.
--
-- New functions: the default privileges below stop a new function from being
-- PUBLIC-executable. A migration that adds a function retrospend_app must call
-- grants it itself; the pg_proc test in src/test/migrations fails otherwise.
--
-- Uses ALTER FUNCTION rather than CREATE OR REPLACE so the bodies, which
-- earlier migrations own, are not copied here. Idempotent: running it again
-- finds everything already in place.

DO $migration$
DECLARE
  f RECORD;
  current_path TEXT;
  new_path TEXT;
  r RECORD;
  -- SECURITY DEFINER functions retrospend_app may execute: RLS policies,
  -- invoker trigger functions and scoped code call them.
  app_keeps TEXT[] := ARRAY[
    'can_write_transaction_splits',
    'claim_header_back_ok',
    'co_participant_counts',
    'has_self_removal_record',
    'is_budget_member',
    'is_budget_owner',
    'is_category_in_user_shared_transaction',
    'is_project_creator',
    'is_split_participant',
    'is_transaction_owner',
    'is_transaction_project_participant',
    'lock_settled_splits',
    'payment_group_check',
    'payment_has_final_rows',
    'payment_has_rows',
    'payment_is_waiting',
    'payment_tx_note_has',
    'project_role',
    'settled_entry_ok',
    'settlement_created_for',
    'settlement_delete_ok',
    'settlement_insert_ok',
    'shared_expense_ids_with',
    'shares_expense_with'
  ];
BEGIN
  FOR f IN
    SELECT p.oid,
           p.proname,
           p.prosecdef,
           format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS sig,
           has_function_privilege('retrospend_app', p.oid, 'EXECUTE') AS app_could,
           (SELECT split_part(c, '=', 2) FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%') AS path
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
       )
     ORDER BY p.proname
  LOOP
    -- A definer function always pins a search_path ending in pg_temp. An
    -- invoker function that already pins one gets pg_temp too.
    IF f.prosecdef OR f.path IS NOT NULL THEN
      current_path := f.path;
      IF current_path IS NULL THEN
        new_path := 'public, pg_temp';
      ELSIF current_path ~ 'pg_temp\s*$' THEN
        new_path := NULL;
      ELSE
        new_path := current_path || ', pg_temp';
      END IF;
      IF new_path IS NOT NULL THEN
        EXECUTE format('ALTER FUNCTION %s SET search_path = %s', f.sig, new_path);
      END IF;
    END IF;

    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);

    IF f.prosecdef THEN
      IF f.proname = ANY (app_keeps) THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO retrospend_app', f.sig);
      ELSE
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM retrospend_app', f.sig);
      END IF;
    ELSIF f.app_could THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO retrospend_app', f.sig);
    END IF;
  END LOOP;

  -- Future functions are not PUBLIC-executable. A schema-scoped default would
  -- not remove the built-in PUBLIC default, so this one is database-wide, for
  -- the role running the migration and every role that already owns defaults
  -- (dev migrates as one role, production as another).
  FOR r IN
    SELECT DISTINCT rolname
      FROM (
        SELECT current_user::text AS rolname
        UNION
        SELECT pg_get_userbyid(defaclrole)::text FROM pg_default_acl
      ) roles
  LOOP
    IF pg_has_role(current_user, r.rolname, 'USAGE') THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', r.rolname);
    ELSE
      RAISE NOTICE 'definer_hygiene: cannot set function default privileges for role %', r.rolname;
    END IF;
  END LOOP;
END
$migration$;

-- Nobody but the owner creates objects in public. A no-op on Postgres 15 and
-- later, where PUBLIC no longer has it, and a fix on older servers.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
