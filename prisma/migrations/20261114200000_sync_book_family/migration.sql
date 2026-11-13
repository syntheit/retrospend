-- The delta log for personal budget books (E2EE lane P, PR P14c; plan
-- docs/roadmap/e2ee-p14-p15.md, section 2). 20261114100000_sync_change stamps
-- rows that carry a "userId". The budget family carries a "bookId": the owner
-- is the book's creator, and only while the book is personal (isPersonal) and
-- has no member besides its creator. A book that stops being so is shared from
-- that moment: the shared path serves it, so its rows leave the delta (Q4).
--
-- 1. sync_book_owner(book): the creator of a personal book that has no other
--    member and whose creator still exists, else NULL. The one place the rule
--    lives; the triggers and the backfill call it once per book per statement.
-- 2. sync_book_tables(): the twelve tables of the family, the column that is
--    each one's id (income_rule_run is keyed by its expense) and the column
--    that names its book (budget_book names itself).
-- 3. sync_stamp_book_rows(): the statement trigger of the eleven child tables
--    (envelope_group, envelope, envelope_category, budget_movement,
--    book_period, month_close, income_rule, income_rule_run, payoff_plan,
--    wealth_transfer, envelope_change). Same upsert as sync_stamp_rows, owner
--    from the book. A delete that finds its book gone (the cascade of a book
--    delete) turns the stamps the rows already have into D; a user deletion
--    stamps nothing, as in P14a (the owner is gone, and the FK on "userId"
--    removes the stamps).
-- 4. sync_stamp_book_self(): the same for budget_book. An UPDATE that flips
--    isPersonal stamps D (or U, when the book becomes personal again) for
--    every row of the book through sync_book_stamp().
-- 5. sync_stamp_book_members(): a member row that comes, goes or changes
--    person makes a personal book shared (D for all its rows, to its creator)
--    or personal again (U for all of them).
-- 6. sync_backfill() is replaced: the nine tables of P14a plus the family.
--    sync_reset() calls it, so a reset rebuilds the whole log.
--
-- A tombstone is never written over a tombstone (a row deleted from a book
-- that was already handed over keeps its first D), so a pull never gets a
-- delete twice. No new table, role or grant: stamps go into the same "sync_change" through
-- definer functions, and the app role still only reads its own. id and bookId
-- never change on these tables (the book's creator and id are frozen by
-- budget_book_keep_creator, the composite foreign keys pin the rest), so an
-- UPDATE stamps U for the new rows and D for a row whose book or id moved.
-- Additive and idempotent.

CREATE OR REPLACE FUNCTION sync_book_owner(p_book TEXT) RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT b."createdById"
  FROM "budget_book" b
  JOIN "user" u ON u."id" = b."createdById"
  WHERE b."id" = p_book
    AND b."isPersonal"
    AND NOT EXISTS (
      SELECT 1 FROM "budget_member" m
      WHERE m."bookId" = b."id" AND m."userId" <> b."createdById"
    )
$$;

CREATE OR REPLACE FUNCTION sync_book_tables()
RETURNS TABLE ("tbl" TEXT, "idcol" TEXT, "bookcol" TEXT)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT * FROM (VALUES
    ('budget_book', 'id', 'id'),
    ('envelope_group', 'id', 'bookId'),
    ('envelope', 'id', 'bookId'),
    ('envelope_category', 'id', 'bookId'),
    ('budget_movement', 'id', 'bookId'),
    ('book_period', 'id', 'bookId'),
    ('month_close', 'id', 'bookId'),
    ('income_rule', 'id', 'bookId'),
    ('income_rule_run', 'expenseId', 'bookId'),
    ('payoff_plan', 'id', 'bookId'),
    ('wealth_transfer', 'id', 'bookId'),
    ('envelope_change', 'id', 'bookId')
  ) AS v("tbl", "idcol", "bookcol")
$$;

-- Stamps every row of one book for its owner with `p_op`: the hand-over (D
-- when the book is shared, U when it is personal again). A stamp of the same
-- op already written by this transaction is left alone. Nothing happens when
-- the owner is gone (a user deletion).
CREATE OR REPLACE FUNCTION sync_book_stamp(p_book TEXT, p_owner TEXT, p_op TEXT) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  t RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "user" WHERE "id" = p_owner) THEN
    RETURN;
  END IF;
  FOR t IN SELECT * FROM sync_book_tables() LOOP
    EXECUTE format(
      'INSERT INTO "sync_change" ("entity", "entityId", "userId", "op", "txid", "seq", "changedAt")
       SELECT %1$L, s."id", %2$L, %3$L, pg_current_xact_id(), nextval(''sync_change_seq''), CURRENT_TIMESTAMP
       FROM (SELECT r.%4$I AS "id" FROM %1$I r WHERE r.%5$I = %6$L ORDER BY 1) s
       ON CONFLICT ("entity", "entityId", "userId") DO UPDATE
         SET "op" = EXCLUDED."op", "txid" = EXCLUDED."txid", "seq" = EXCLUDED."seq",
             "changedAt" = EXCLUDED."changedAt"
         WHERE "sync_change"."op" <> EXCLUDED."op"
           OR ("sync_change"."txid" <> EXCLUDED."txid" AND EXCLUDED."op" = ''U'')',
      t."tbl", p_owner, p_op, t."idcol", t."bookcol", p_book);
  END LOOP;
END;
$$;

-- The child tables. TG_ARGV[0] is the entity (the table name), TG_ARGV[1] the
-- id column (default id). The statements are built with format() only for the
-- id column and the transition table's name; the transition tables are
-- new_rows (INSERT, UPDATE) and old_rows (UPDATE, DELETE).
CREATE OR REPLACE FUNCTION sync_stamp_book_rows() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entity TEXT := TG_ARGV[0];
  v_idcol  TEXT := COALESCE(TG_ARGV[1], 'id');
  -- 1 entity, 2 op, 3 id column, 4 transition table, 5 extra condition.
  stamp CONSTANT TEXT := $sql$
    INSERT INTO "sync_change" ("entity", "entityId", "userId", "op", "txid", "seq", "changedAt")
    SELECT %1$L, s."id", s."uid", %2$L, pg_current_xact_id(), nextval('sync_change_seq'), CURRENT_TIMESTAMP
    FROM (
      SELECT x.%3$I AS "id", o."uid"
      FROM %4$I x
      JOIN (
        SELECT k."bookId", sync_book_owner(k."bookId") AS "uid"
        FROM (SELECT DISTINCT "bookId" FROM %4$I) k
      ) o ON o."bookId" = x."bookId"
      WHERE o."uid" IS NOT NULL %5$s
      ORDER BY 1
    ) s
    ON CONFLICT ("entity", "entityId", "userId") DO UPDATE
      SET "op" = EXCLUDED."op", "txid" = EXCLUDED."txid", "seq" = EXCLUDED."seq",
          "changedAt" = EXCLUDED."changedAt"
      WHERE "sync_change"."op" <> EXCLUDED."op"
           OR ("sync_change"."txid" <> EXCLUDED."txid" AND EXCLUDED."op" = 'U')
  $sql$;
BEGIN
  IF TG_OP = 'INSERT' THEN
    EXECUTE format(stamp, v_entity, 'U', v_idcol, 'new_rows', '');
  ELSIF TG_OP = 'DELETE' THEN
    EXECUTE format(stamp, v_entity, 'D', v_idcol, 'old_rows', '');
    -- The book is gone (it was deleted, and this is its cascade): the owner is
    -- not known any more, but the rows' own stamps say who had them.
    EXECUTE format($sql$
      INSERT INTO "sync_change" ("entity", "entityId", "userId", "op", "txid", "seq", "changedAt")
      SELECT s."entity", s."entityId", s."userId", 'D', pg_current_xact_id(),
             nextval('sync_change_seq'), CURRENT_TIMESTAMP
      FROM (
        SELECT c."entity", c."entityId", c."userId"
        FROM "sync_change" c
        WHERE c."entity" = %1$L AND c."op" = 'U'
          AND c."entityId" IN (
            SELECT o.%2$I FROM old_rows o
            WHERE NOT EXISTS (SELECT 1 FROM "budget_book" b WHERE b."id" = o."bookId")
          )
        ORDER BY c."entityId"
      ) s
      ON CONFLICT ("entity", "entityId", "userId") DO UPDATE
        SET "op" = EXCLUDED."op", "txid" = EXCLUDED."txid", "seq" = EXCLUDED."seq",
            "changedAt" = EXCLUDED."changedAt"
        WHERE "sync_change"."op" <> EXCLUDED."op"
           OR ("sync_change"."txid" <> EXCLUDED."txid" AND EXCLUDED."op" = 'U')
    $sql$, v_entity, v_idcol);
  ELSE
    -- D for an old row that left its book or changed id, then U for every new
    -- row (the U wins when both name the same key).
    EXECUTE format(stamp, v_entity, 'D', v_idcol, 'old_rows',
      format('AND NOT EXISTS (SELECT 1 FROM new_rows n WHERE n.%1$I = x.%1$I AND n."bookId" = x."bookId")', v_idcol));
    EXECUTE format(stamp, v_entity, 'U', v_idcol, 'new_rows', '');
  END IF;
  RETURN NULL;
END;
$$;

-- budget_book itself. The owner is the row's own creator.
CREATE OR REPLACE FUNCTION sync_stamp_book_self() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  b RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "sync_change" ("entity", "entityId", "userId", "op", "txid", "seq", "changedAt")
    SELECT 'budget_book', s."id", s."uid", 'U', pg_current_xact_id(),
           nextval('sync_change_seq'), CURRENT_TIMESTAMP
    FROM (
      SELECT n."id", sync_book_owner(n."id") AS "uid" FROM new_rows n ORDER BY n."id"
    ) s
    WHERE s."uid" IS NOT NULL
    ON CONFLICT ("entity", "entityId", "userId") DO UPDATE
      SET "op" = EXCLUDED."op", "txid" = EXCLUDED."txid", "seq" = EXCLUDED."seq",
          "changedAt" = EXCLUDED."changedAt"
      WHERE "sync_change"."op" <> EXCLUDED."op"
           OR ("sync_change"."txid" <> EXCLUDED."txid" AND EXCLUDED."op" = 'U');
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO "sync_change" ("entity", "entityId", "userId", "op", "txid", "seq", "changedAt")
    SELECT 'budget_book', s."id", s."uid", 'D', pg_current_xact_id(),
           nextval('sync_change_seq'), CURRENT_TIMESTAMP
    FROM (
      SELECT o."id", o."createdById" AS "uid"
      FROM old_rows o JOIN "user" u ON u."id" = o."createdById"
      WHERE o."isPersonal"
      ORDER BY o."id"
    ) s
    ON CONFLICT ("entity", "entityId", "userId") DO UPDATE
      SET "op" = EXCLUDED."op", "txid" = EXCLUDED."txid", "seq" = EXCLUDED."seq",
          "changedAt" = EXCLUDED."changedAt"
      WHERE "sync_change"."op" <> EXCLUDED."op"
           OR ("sync_change"."txid" <> EXCLUDED."txid" AND EXCLUDED."op" = 'U');
  ELSE
    -- U for a book that is personal and alone. One that is not stamps nothing
    -- here: a flip of isPersonal is handled below (the book's own D comes with
    -- its rows'), a member's arrival by sync_stamp_book_members.
    INSERT INTO "sync_change" ("entity", "entityId", "userId", "op", "txid", "seq", "changedAt")
    SELECT 'budget_book', s."id", s."uid", 'U', pg_current_xact_id(),
           nextval('sync_change_seq'), CURRENT_TIMESTAMP
    FROM (
      SELECT n."id", sync_book_owner(n."id") AS "uid" FROM new_rows n ORDER BY n."id"
    ) s
    WHERE s."uid" IS NOT NULL
    ON CONFLICT ("entity", "entityId", "userId") DO UPDATE
      SET "op" = EXCLUDED."op", "txid" = EXCLUDED."txid", "seq" = EXCLUDED."seq",
          "changedAt" = EXCLUDED."changedAt"
      WHERE "sync_change"."op" <> EXCLUDED."op"
           OR ("sync_change"."txid" <> EXCLUDED."txid" AND EXCLUDED."op" = 'U');
    -- The book's rows follow its isPersonal flag, when nobody else is a member.
    FOR b IN
      SELECT o."id", o."createdById", n."isPersonal" AS "nowPersonal"
      FROM old_rows o JOIN new_rows n ON n."id" = o."id"
      WHERE o."isPersonal" IS DISTINCT FROM n."isPersonal"
        AND NOT EXISTS (
          SELECT 1 FROM "budget_member" m
          WHERE m."bookId" = o."id" AND m."userId" <> o."createdById"
        )
      ORDER BY o."id"
    LOOP
      PERFORM sync_book_stamp(b."id", b."createdById", CASE WHEN b."nowPersonal" THEN 'U' ELSE 'D' END);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

-- A member row that comes, goes or changes person. Only a personal book is
-- ever synced, so a shared one is left alone. A book that has another member
-- is shared from now on (D for its rows); one that is down to its creator is
-- personal again (U). The creator's own member row, written at setup, finds a
-- solo book and writes nothing new.
CREATE OR REPLACE FUNCTION sync_stamp_book_members() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  ids TEXT[];
  b RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n."bookId") INTO ids FROM new_rows n;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o."bookId") INTO ids FROM old_rows o;
  ELSE
    SELECT array_agg(DISTINCT x."bookId") INTO ids FROM (
      SELECT n."bookId" FROM new_rows n JOIN old_rows o ON o."id" = n."id"
      WHERE o."userId" IS DISTINCT FROM n."userId" OR o."bookId" IS DISTINCT FROM n."bookId"
      UNION
      SELECT o."bookId" FROM old_rows o JOIN new_rows n ON n."id" = o."id"
      WHERE o."userId" IS DISTINCT FROM n."userId" OR o."bookId" IS DISTINCT FROM n."bookId"
    ) x;
  END IF;
  IF ids IS NULL THEN
    RETURN NULL;
  END IF;
  FOR b IN
    SELECT bb."id", bb."createdById", (sync_book_owner(bb."id") IS NOT NULL) AS "solo"
    FROM "budget_book" bb
    WHERE bb."id" = ANY (ids) AND bb."isPersonal"
    ORDER BY bb."id"
  LOOP
    PERFORM sync_book_stamp(b."id", b."createdById", CASE WHEN b."solo" THEN 'U' ELSE 'D' END);
  END LOOP;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT * FROM sync_book_tables() LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'sync_' || t."tbl" || '_ins', t."tbl");
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'sync_' || t."tbl" || '_upd', t."tbl");
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'sync_' || t."tbl" || '_del', t."tbl");
    IF t."tbl" = 'budget_book' THEN
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows
           FOR EACH STATEMENT EXECUTE FUNCTION sync_stamp_book_self()',
        'sync_' || t."tbl" || '_ins', t."tbl");
      EXECUTE format(
        'CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
           FOR EACH STATEMENT EXECUTE FUNCTION sync_stamp_book_self()',
        'sync_' || t."tbl" || '_upd', t."tbl");
      EXECUTE format(
        'CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows
           FOR EACH STATEMENT EXECUTE FUNCTION sync_stamp_book_self()',
        'sync_' || t."tbl" || '_del', t."tbl");
    ELSE
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows
           FOR EACH STATEMENT EXECUTE FUNCTION sync_stamp_book_rows(%L, %L)',
        'sync_' || t."tbl" || '_ins', t."tbl", t."tbl", t."idcol");
      EXECUTE format(
        'CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
           FOR EACH STATEMENT EXECUTE FUNCTION sync_stamp_book_rows(%L, %L)',
        'sync_' || t."tbl" || '_upd', t."tbl", t."tbl", t."idcol");
      EXECUTE format(
        'CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows
           FOR EACH STATEMENT EXECUTE FUNCTION sync_stamp_book_rows(%L, %L)',
        'sync_' || t."tbl" || '_del', t."tbl", t."tbl", t."idcol");
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS "sync_budget_member_ins" ON "budget_member";
CREATE TRIGGER "sync_budget_member_ins"
  AFTER INSERT ON "budget_member" REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION sync_stamp_book_members();
DROP TRIGGER IF EXISTS "sync_budget_member_upd" ON "budget_member";
CREATE TRIGGER "sync_budget_member_upd"
  AFTER UPDATE ON "budget_member" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION sync_stamp_book_members();
DROP TRIGGER IF EXISTS "sync_budget_member_del" ON "budget_member";
CREATE TRIGGER "sync_budget_member_del"
  AFTER DELETE ON "budget_member" REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION sync_stamp_book_members();

-- Stamps every existing row of the nine tables and of the personal books'
-- family with U, once. A row that has a stamp keeps it. Returns the number of
-- stamps written. Owner only; sync_reset() reuses it.
CREATE OR REPLACE FUNCTION sync_backfill() RETURNS bigint
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  t TEXT;
  r RECORD;
  n BIGINT;
  total BIGINT := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'expense', 'category', 'recurring_template', 'asset_account', 'asset_snapshot',
    'asset_history', 'account_leg', 'transfer', 'asset_rate_type'
  ] LOOP
    EXECUTE format(
      'INSERT INTO "sync_change" ("entity", "entityId", "userId", "op", "txid", "seq", "changedAt")
       SELECT %L, s."id", s."userId", ''U'', pg_current_xact_id(), nextval(%L), CURRENT_TIMESTAMP
       FROM (SELECT r."id", r."userId" FROM %I r JOIN "user" u ON u."id" = r."userId" ORDER BY r."id") s
       ON CONFLICT ("entity", "entityId", "userId") DO NOTHING',
      t, 'sync_change_seq', t);
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
  END LOOP;
  FOR r IN SELECT * FROM sync_book_tables() LOOP
    EXECUTE format(
      'INSERT INTO "sync_change" ("entity", "entityId", "userId", "op", "txid", "seq", "changedAt")
       SELECT %1$L, s."id", s."uid", ''U'', pg_current_xact_id(), nextval(%2$L), CURRENT_TIMESTAMP
       FROM (
         SELECT x.%3$I AS "id", o."uid"
         FROM %1$I x
         JOIN (SELECT b."id" AS "book", sync_book_owner(b."id") AS "uid" FROM "budget_book" b) o
           ON o."book" = x.%4$I
         WHERE o."uid" IS NOT NULL
         ORDER BY 1
       ) s
       ON CONFLICT ("entity", "entityId", "userId") DO NOTHING',
      r."tbl", 'sync_change_seq', r."idcol", r."bookcol");
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
  END LOOP;
  RETURN total;
END;
$$;

-- Stamp what exists. After the triggers exist, and a row that already has a
-- stamp keeps it.
SELECT sync_backfill();
