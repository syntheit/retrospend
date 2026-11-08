-- Is this a brand-new install, one the owner has never had a chance to plant
-- anything in? scripts/db-owner gives the owner CREATE on the database for the
-- length of the migrations only when this says yes. Catalog reads only (the
-- rule in owner-role.sql); run as the superuser before the handover.
--
-- Yes means one of:
--   - the marker the superuser set on an earlier start of this install that did
--     not finish (ALTER DATABASE ... SET retrospend.fresh_install = 'on'; only a
--     superuser or the database owner can write it, so the owner role cannot
--     fake it), so a first migration that failed halfway can be retried;
--   - public holds no relation and no routine at all, apart from extension
--     members: nothing of anyone's has run yet. A database with tables, or with
--     only a function or a view an owner planted, is not new, and neither is
--     one whose tables were dropped to look new (a planted function stays).
-- Every upgrade has tables, so it never gets CREATE; its pending migrations must
-- not need it (src/test/migrations/database-create.test.ts).

SELECT (
  EXISTS (
    SELECT 1
      FROM pg_catalog.pg_db_role_setting s
      JOIN pg_catalog.pg_database d ON d.oid = s.setdatabase
     WHERE d.datname = pg_catalog.current_database()
       AND s.setrole = 0
       AND 'retrospend.fresh_install=on' = ANY (s.setconfig)
  )
  OR (
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
       WHERE c.relnamespace = 'public'::pg_catalog.regnamespace
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S', 'c')
         AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_depend d
            WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
              AND d.objid = c.oid AND d.deptype = 'e')
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.pronamespace = 'public'::pg_catalog.regnamespace
         AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_depend d
            WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
              AND d.objid = p.oid AND d.deptype = 'e')
    )
  )
) AS fresh;
