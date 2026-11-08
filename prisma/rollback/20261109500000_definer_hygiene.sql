-- Rollback for migration 20261109500000_definer_hygiene. Not a migration:
-- Prisma never runs this file. Migrations run on container start, so an image
-- rollback cannot undo that migration; run this by hand, as the role that
-- owns the functions (the one that ran the migrations), against the database:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollback/20261109500000_definer_hygiene.sql
--
-- It puts back what the migration changed, for the 35 functions whose grants or
-- search_path it touched (generated from a catalog diff of a database migrated
-- to 20261109300000 against one migrated to 20261109500000, and checked by
-- src/test/migrations/definer-rollback.pg.test.ts):
--   * the PUBLIC EXECUTE the migration revoked (the budget_dirty_* and other
--     functions, the RLS helpers is_budget_member, is_budget_owner,
--     is_category_in_user_shared_transaction, lock_settled_splits, the two
--     trigger functions push_device_drop_for_disabled_key and
--     release_payment_locks, the account_* functions and the invoker guards);
--   * retrospend_app's EXECUTE on settlement_confirmed_by;
--   * the plain `public` search_path of the definer functions that had no
--     pg_temp;
--   * the PUBLIC default for new functions.
-- It does not restore CREATE on schema public for PUBLIC: that was already
-- absent on Postgres 15 and later, and handing it back is never wanted.
--
-- The result is the same grants and search_path. The restored ACLs equal what
-- the earlier state had, entry for entry, so the test compares them as such.
-- Idempotent: running it twice changes nothing more.

DO $rollback$
DECLARE
  f RECORD;
  r RECORD;
  -- PUBLIC could execute these before the migration (their ACL was empty,
  -- which means the default, PUBLIC).
  public_again TEXT[] := ARRAY[
    'account_cap_counted',
    'account_leg_apply',
    'account_leg_moves_balance',
    'account_usd_per_unit',
    'budget_book_keep_creator',
    'budget_dirty_add',
    'budget_dirty_book_day',
    'budget_dirty_category_kind',
    'budget_dirty_expense_rows',
    'budget_dirty_expense_update',
    'budget_dirty_month',
    'budget_dirty_payment',
    'budget_dirty_rate_back',
    'budget_dirty_rate_rows',
    'budget_dirty_routing',
    'budget_dirty_settlement',
    'budget_dirty_settlement_row',
    'budget_dirty_share',
    'budget_dirty_share_row',
    'budget_dirty_shared_tx',
    'budget_dirty_split_tx',
    'budget_dirty_user',
    'budget_dirty_wealth',
    'budget_party_user',
    'immutable_unaccent',
    'is_budget_member',
    'is_budget_owner',
    'is_category_in_user_shared_transaction',
    'lock_settled_splits',
    'project_participant_guard_update',
    'push_device_drop_for_disabled_key',
    'release_payment_locks',
    'shared_transaction_guard_update',
    'split_participant_guard_update'
  ];
  -- Their search_path was `public`, with no pg_temp.
  path_public TEXT[] := ARRAY[
    'budget_dirty_add',
    'budget_dirty_book_day',
    'budget_dirty_category_kind',
    'budget_dirty_expense_rows',
    'budget_dirty_expense_update',
    'budget_dirty_month',
    'budget_dirty_payment',
    'budget_dirty_rate_back',
    'budget_dirty_rate_rows',
    'budget_dirty_routing',
    'budget_dirty_settlement',
    'budget_dirty_settlement_row',
    'budget_dirty_share',
    'budget_dirty_share_row',
    'budget_dirty_shared_tx',
    'budget_dirty_split_tx',
    'budget_dirty_user',
    'budget_dirty_wealth',
    'budget_party_user',
    'is_budget_member',
    'is_budget_owner',
    'is_category_in_user_shared_transaction',
    'lock_settled_splits',
    'push_device_drop_for_disabled_key',
    'release_payment_locks'
  ];
BEGIN
  FOR f IN
    SELECT p.proname,
           format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
       )
     ORDER BY p.proname
  LOOP
    IF f.proname = ANY (path_public) THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', f.sig);
    END IF;

    IF f.proname = ANY (public_again) THEN
      -- Back to the empty ACL, which means the default: the owner and PUBLIC.
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, retrospend_app', f.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', f.sig);
    END IF;

    IF f.proname = 'settlement_confirmed_by' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO retrospend_app', f.sig);
    END IF;

    -- immutable_unaccent had PUBLIC and an explicit retrospend_app grant.
    IF f.proname = 'immutable_unaccent' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO retrospend_app', f.sig);
    END IF;
  END LOOP;

  -- New functions are PUBLIC-executable again, as Postgres has it by default.
  FOR r IN
    SELECT DISTINCT pg_get_userbyid(defaclrole)::text AS rolname
      FROM pg_default_acl
     WHERE defaclobjtype = 'f' AND defaclnamespace = 0
  LOOP
    IF pg_has_role(current_user, r.rolname, 'USAGE') THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I GRANT EXECUTE ON FUNCTIONS TO PUBLIC', r.rolname);
    ELSE
      RAISE NOTICE 'definer_hygiene rollback: cannot reset function default privileges for role %', r.rolname;
    END IF;
  END LOOP;
END
$rollback$;
