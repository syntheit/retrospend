-- The privileges of retrospend_app: the single source of truth, safe to run
-- again at any time. docker-entrypoint.sh applies it after `prisma migrate
-- deploy` on every start, and scripts/sync-dev-db.sh applies it after a copy.
--
-- Why a file besides the migrations: a dump made with --no-privileges (the
-- sidecar's backups, and the documented `pg_restore --clean`) recreates every
-- table with no grants for the app role, and the restored _prisma_migrations
-- table says every migration already ran, so nothing would give the grants
-- back. The migrations still do the one-time narrowing for installs that never
-- run this file (pnpm dev, the test harness); this file is what a database
-- must end up with. src/test/migrations/grants-file.pg.test.ts proves the two
-- agree: it takes the grants away, applies this file and compares the result
-- with the privilege ratchet (retrospend-app-privileges.json).
--
-- It grants to retrospend_app only. It never names the role that owns the
-- tables, so it works whoever runs it. It resets the table and sequence
-- grants of retrospend_app and grants each one by name, never by ON ALL
-- TABLES. A new table is added here, in the migration that creates it, and in
-- the ratchet expectation: the test fails until all three agree.
--
-- Not covered here: policies on tables other than "user" and "invite_code"
-- (pg_dump keeps those, with row-level security on). Function bodies, owners
-- and search_path survive a dump; their grants do not, so the function section
-- below puts them back.
--
-- Everything runs in one transaction, so a running app never sees the app role
-- without its grants. GRANT and REVOKE take no lock that waits behind a reader.

BEGIN;
-- A start that cannot get a lock fails (and the entrypoint stops) instead of
-- waiting behind another session for ever.
SET LOCAL lock_timeout = '10s';

GRANT USAGE ON SCHEMA public TO retrospend_app;
-- Nobody but the owner creates objects in public (a no-op on Postgres 15+).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Start from nothing, then grant each table and sequence by name. Revoking on
-- a table also revokes its column privileges.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM retrospend_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM retrospend_app;

-- Tables
GRANT DELETE, INSERT, SELECT, UPDATE ON "account_leg" TO retrospend_app;
GRANT SELECT ON "admin_access_log" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ai_usage" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "analytics_category_preference" TO retrospend_app;
GRANT INSERT, SELECT ON "api_event" TO retrospend_app;
GRANT DELETE, SELECT ON "apikey" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "asset_account" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "asset_history" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "asset_rate_type" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "asset_snapshot" TO retrospend_app;
GRANT INSERT, SELECT ON "audit_log_entry" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "billing_period" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "book_period" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "budget" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "budget_book" TO retrospend_app;
GRANT DELETE, INSERT, SELECT ON "budget_dirty" TO retrospend_app;
GRANT INSERT, SELECT, UPDATE ON "budget_draft" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "budget_member" TO retrospend_app;
GRANT INSERT, SELECT ON "budget_movement" TO retrospend_app;
GRANT INSERT, SELECT ON "budget_row_value" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "category" TO retrospend_app;
GRANT SELECT ON "device_code" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "envelope" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "envelope_category" TO retrospend_app;
GRANT INSERT, SELECT, UPDATE ON "envelope_change" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "envelope_group" TO retrospend_app;
GRANT DELETE, INSERT, SELECT ON "error_report" TO retrospend_app;
GRANT SELECT ON "exchange_rate" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "exchange_rate_favorite" TO retrospend_app;
GRANT SELECT ON "exchange_rate_history" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "expense" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "export_job" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "feedback" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "fix_request" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "guest_session" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "idempotency_key" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "import_job" TO retrospend_app;
GRANT INSERT, SELECT, UPDATE ON "income_rule" TO retrospend_app;
GRANT INSERT, SELECT, UPDATE ON "income_rule_run" TO retrospend_app;
GRANT DELETE, INSERT, SELECT ON "invite_code" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "magic_link" TO retrospend_app;
GRANT INSERT, SELECT, UPDATE ON "month_close" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "needs_you_snooze" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "notification" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "notification_preference" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "payment" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "payment_method" TO retrospend_app;
GRANT INSERT, SELECT, UPDATE ON "payoff_plan" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "project" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "project_participant" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "push_device" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "recurring_template" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "settlement" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "shadow_profile" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "shared_transaction" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "split_participant" TO retrospend_app;
GRANT SELECT ON "system_status" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "transfer" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "user_page_setting" TO retrospend_app;
GRANT DELETE, INSERT, SELECT ON "wealth_transfer" TO retrospend_app;
GRANT DELETE, INSERT, SELECT, UPDATE ON "webhook" TO retrospend_app;
GRANT SELECT ON "webhook_delivery" TO retrospend_app;

-- Columns: "user" is readable except pendingEmailToken and consentIp, and
-- writable only in the profile and settings columns.
GRANT SELECT (
  "aiImportEnabled",
  "aiMode",
  "autoAcceptSplits",
  "avatarPath",
  "categoryClickBehavior",
  "consentVersion",
  "consentedAt",
  "createdAt",
  "currencySymbolStyle",
  "defaultAccounts",
  "defaultCurrency",
  "defaultExpenseDateBehavior",
  "defaultPrivacyMode",
  "defaultRateTypes",
  "email",
  "emailVerified",
  "externalAiAllowed",
  "fiscalMonthStartDay",
  "homeCurrency",
  "id",
  "image",
  "isActive",
  "language",
  "lastUsernameChangeAt",
  "monthlyIncome",
  "monthlyIncomeCurrency",
  "name",
  "numberFormat",
  "pendingEmail",
  "pendingEmailExpiresAt",
  "role",
  "smartCurrencyFormatting",
  "timeZone",
  "twoFactorEnabled",
  "updatedAt",
  "username"
) ON "user" TO retrospend_app;
GRANT UPDATE (
  "aiImportEnabled",
  "aiMode",
  "autoAcceptSplits",
  "avatarPath",
  "categoryClickBehavior",
  "consentIp",
  "consentVersion",
  "consentedAt",
  "currencySymbolStyle",
  "defaultAccounts",
  "defaultCurrency",
  "defaultExpenseDateBehavior",
  "defaultPrivacyMode",
  "defaultRateTypes",
  "fiscalMonthStartDay",
  "homeCurrency",
  "language",
  "monthlyIncome",
  "monthlyIncomeCurrency",
  "name",
  "numberFormat",
  "pendingEmail",
  "pendingEmailExpiresAt",
  "pendingEmailToken",
  "smartCurrencyFormatting",
  "timeZone",
  "updatedAt"
) ON "user" TO retrospend_app;

-- Sequences
GRANT SELECT, USAGE ON SEQUENCE "api_event_seq_seq" TO retrospend_app;
GRANT SELECT, USAGE ON SEQUENCE "budget_dirty_id_seq" TO retrospend_app;

-- Row-level security on "user": every row readable, only the caller's own row
-- updatable. On "invite_code": a user's own codes only. Enabling it and
-- creating a policy take an ACCESS EXCLUSIVE lock, which waits behind a running
-- pg_dump (it holds read locks for the whole dump) and blocks every query on
-- the table behind it. pg_dump keeps policies, so normally they are all in
-- place: each statement runs only when the flag or the policy is missing or
-- differs from the definition below, and checking reads the catalog without
-- locking the table.
DO $rls$
DECLARE
  p RECORD;
  in_place BOOLEAN;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = '"user"'::regclass) THEN
    ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = '"invite_code"'::regclass) THEN
    ALTER TABLE "invite_code" ENABLE ROW LEVEL SECURITY;
  END IF;

  -- table, policy, command, USING and WITH CHECK as pg_get_expr prints them,
  -- and the statement that creates it.
  FOR p IN
    SELECT * FROM (VALUES
      ('user', 'user_select_all', 'r', 'true', NULL::text,
       'CREATE POLICY user_select_all ON "user" AS PERMISSIVE FOR SELECT TO retrospend_app USING (true)'),
      ('user', 'user_update_own', 'w',
       '(id = current_setting(''app.current_user_id''::text, true))',
       '(id = current_setting(''app.current_user_id''::text, true))',
       'CREATE POLICY user_update_own ON "user" AS PERMISSIVE FOR UPDATE TO retrospend_app USING ("id" = current_setting(''app.current_user_id'', TRUE)) WITH CHECK ("id" = current_setting(''app.current_user_id'', TRUE))'),
      ('invite_code', 'invite_code_own', '*',
       '("createdById" = current_setting(''app.current_user_id''::text, true))',
       '("createdById" = current_setting(''app.current_user_id''::text, true))',
       'CREATE POLICY invite_code_own ON "invite_code" AS PERMISSIVE FOR ALL TO retrospend_app USING ("createdById" = current_setting(''app.current_user_id'', TRUE)) WITH CHECK ("createdById" = current_setting(''app.current_user_id'', TRUE))')
    ) AS v(tbl, name, cmd, qual, wcheck, ddl)
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_policy pol
       WHERE pol.polrelid = quote_ident(p.tbl)::regclass
         AND pol.polname = p.name
         AND pol.polcmd = p.cmd::"char"
         AND pol.polpermissive
         AND pol.polroles = ARRAY['retrospend_app'::regrole::oid]
         AND pg_get_expr(pol.polqual, pol.polrelid) IS NOT DISTINCT FROM p.qual
         AND pg_get_expr(pol.polwithcheck, pol.polrelid) IS NOT DISTINCT FROM p.wcheck
    ) INTO in_place;
    IF NOT in_place THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', p.name, p.tbl);
      EXECUTE p.ddl;
    END IF;
  END LOOP;
END
$rls$;

-- The key store (20261109100000_keystore): the app role reaches its own key
-- through two functions and nothing else. Skipped when the schema is missing
-- (a restore without the keystore dump); the keystore migration is run again
-- in that case, see docs/self-hosting.md.
DO $keystore$
BEGIN
  IF to_regnamespace('keystore') IS NOT NULL THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA keystore FROM retrospend_app;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA keystore FROM retrospend_app;
    GRANT USAGE ON SCHEMA keystore TO retrospend_app;
    REVOKE EXECUTE ON FUNCTION keystore."current_user_data_keys"() FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION keystore."create_first_data_key"(text, bigint) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION keystore."current_user_data_keys"() TO retrospend_app;
    GRANT EXECUTE ON FUNCTION keystore."create_first_data_key"(text, bigint) TO retrospend_app;
  END IF;
END
$keystore$;

-- Functions in public: nobody but the owner may execute them, except
-- retrospend_app on the ones its policies, invoker triggers and scoped code
-- call. The list is src/test/migrations/definer-functions.json
-- (appExecutable and invokerAppExecutable), by name. A dump made with
-- --no-privileges leaves every function executable by PUBLIC, so this runs
-- every start. Extension functions (unaccent) are not touched.
DO $functions$
DECLARE
  f RECORD;
  app_keeps TEXT[] := ARRAY[
    'account_cap_counted',
    'account_leg_apply',
    'account_leg_moves_balance',
    'account_usd_per_unit',
    'budget_book_keep_creator',
    'budget_dirty_month',
    'can_write_transaction_splits',
    'claim_header_back_ok',
    'co_participant_counts',
    'currency_step',
    'has_self_removal_record',
    'immutable_unaccent',
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
    'project_participant_guard_update',
    'project_role',
    'settled_entry_ok',
    'settlement_created_for',
    'settlement_delete_ok',
    'settlement_insert_ok',
    'shared_expense_ids_with',
    'shared_transaction_guard_update',
    'shares_expense_with',
    'split_participant_guard_update'
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
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    IF f.proname = ANY (app_keeps) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO retrospend_app', f.sig);
    ELSE
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM retrospend_app', f.sig);
    END IF;
  END LOOP;
END
$functions$;

-- Default privileges: new tables, sequences and functions are granted to
-- nobody. Set for the role running this file and every role that already owns
-- defaults. A dump made with --no-privileges drops them, so they come back here.
DO $defaults$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT rolname
      FROM (
        SELECT current_user::text AS rolname
        UNION
        SELECT pg_get_userbyid(defaclrole)::text FROM pg_default_acl
      ) roles
  LOOP
    IF pg_has_role(current_user, r.rolname, 'USAGE') THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM retrospend_app', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM retrospend_app', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM retrospend_app', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON TABLES FROM retrospend_app', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON SEQUENCES FROM retrospend_app', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON FUNCTIONS FROM PUBLIC, retrospend_app', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON TABLES FROM PUBLIC', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON SEQUENCES FROM PUBLIC', r.rolname);
    ELSE
      RAISE NOTICE 'app-role grants: cannot set default privileges for role %', r.rolname;
    END IF;
  END LOOP;
END
$defaults$;

COMMIT;
