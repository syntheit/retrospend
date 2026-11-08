-- Is this a brand-new, empty database? scripts/db-owner migrates only a database
-- for which this says yes as a one-shot role that holds CREATE on the database. Catalog
-- reads only (the rule in owner-role.sql); run as the superuser before the owner
-- is given anything.
--
-- Yes means nothing in the database can carry code: no relation (table, view,
-- sequence, composite type: triggers, rules, defaults, constraints and policies
-- hang off these), no routine, no operator and no standalone type, in any schema
-- but pg_* and information_schema, apart from extension members (unaccent). With
-- nothing like that in it, there is nothing for the owner to have planted, so the
-- migrations cannot run owner code while a role holds CREATE. It does not
-- matter which schema holds a payload: one in keystore, with public emptied,
-- reads as not new.
--
-- No role-based or marker-based shortcut is used. Whether retrospend_owner
-- exists says nothing about this database (the role is cluster-wide, so a second
-- database on a cluster would never be new, and neither would the test
-- databases). A marker kept across a failed first start cannot be told from one
-- an owner forged unless the superuser reads the owner's migration table, which
-- the rule forbids. So a first start that fails inside the very first migration
-- (the only one that needs CREATE) is not retried as a new install: drop the
-- database and create it again empty.
--
-- Every upgrade has tables, so it never gets CREATE; its pending migrations must
-- not need it (src/test/migrations/database-create.test.ts).

WITH user_schemas AS (
  SELECT oid FROM pg_catalog.pg_namespace
   WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'
)
SELECT (
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
     WHERE c.relnamespace IN (SELECT oid FROM user_schemas)
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S', 'c')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_depend d
          WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
            AND d.objid = c.oid AND d.deptype = 'e')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.pronamespace IN (SELECT oid FROM user_schemas)
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_depend d
          WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
            AND d.objid = p.oid AND d.deptype = 'e')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_operator o
     WHERE o.oprnamespace IN (SELECT oid FROM user_schemas)
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_depend d
          WHERE d.classid = 'pg_catalog.pg_operator'::pg_catalog.regclass
            AND d.objid = o.oid AND d.deptype = 'e')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
     WHERE t.typnamespace IN (SELECT oid FROM user_schemas)
       AND t.typtype IN ('b', 'd', 'e', 'r', 'm')
       AND t.typcategory <> 'A'
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_depend d
          WHERE d.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
            AND d.objid = t.oid AND d.deptype = 'e')
  )
) AS fresh;
