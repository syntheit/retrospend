-- An "updatedAt" stamp always moves forward when a row is updated.
--
-- "updatedAt" is TIMESTAMP(3), set by the Prisma client (@updatedAt, the app
-- server's clock). Two updates of one row in the same millisecond, or from an
-- app server whose clock is behind, stored the same stamp (or an older one), so
-- a compare-and-set that checks only "updatedAt" (an expense or shared expense
-- write that names the stamp it read, a recurring template edit, the category
-- merge's undo) passed a stale stamp and overwrote the other write.
--
-- One BEFORE UPDATE trigger function and one row trigger per stamped table.
-- The trigger is a column trigger ("UPDATE OF"): it fires when "updatedAt" is
-- in the statement's SET list, which every Prisma update is, and not for the
-- updates that leave the column out (an FK ON DELETE SET NULL, a balance
-- written by a trigger), which keep their stamp. When it fires, the stored
-- stamp is the larger of the one the update set and the old one plus a
-- millisecond, so a stamp never stalls and never goes back. Nothing on INSERT:
-- the client's create value stands (tests seed fixed stamps through create).
--
-- SECURITY INVOKER: it only reads OLD and writes NEW. It needs no EXECUTE for
-- retrospend_app (Postgres checks EXECUTE on a trigger function when the trigger
-- is created, not when it fires); src/test/migrations has a test that an update
-- made as retrospend_app still advances the stamp.
--
-- The tables are every @updatedAt model of prisma/schema.prisma except two,
-- each with a reason (src/server/services/sync/stamps-coverage.pg.test.ts builds
-- the list from the schema and the trigger catalog, and fails on a difference):
--   asset_account: the stamp is kept on purpose. An icon swap writes the stamp
--     it read back (accounts/icon.ts) and an undone delete writes the old stamp
--     back (accounts/delete-snapshot.ts); a trigger would move both. The only
--     server reader (api-v1/guard.ts, stampOfAccount) hashes it together with
--     balance, closedAt, rate type and row counts; no client-held version
--     compares it.
--   exchange_rate: written by the sidecar with NOW() and backdated by the rate
--     tests; read only as freshness (the newest stamp, rates_moved), never as a
--     lost-write guard.
--
-- Rollback: prisma/rollback/20261126100000_stamps_always_move.sql.

CREATE OR REPLACE FUNCTION stamp_moves() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW."updatedAt" := GREATEST(NEW."updatedAt", OLD."updatedAt" + interval '1 millisecond');
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user', 'session', 'account', 'verification', 'expense', 'recurring_template',
    'budget', 'budget_book', 'envelope_group', 'envelope', 'budget_draft',
    'income_rule', 'income_rule_run', 'payoff_plan', 'app_settings',
    'needs_you_snooze', 'system_status', 'ai_usage', 'shadow_profile',
    'shared_transaction', 'split_participant', 'payment', 'fix_request', 'project',
    'payment_method', 'feedback', 'push_device', 'webhook', 'protection_key_set'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_stamp_moves', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OF "updatedAt" ON %I
         FOR EACH ROW EXECUTE FUNCTION stamp_moves()',
      t || '_stamp_moves', t);
  END LOOP;
END $$;
