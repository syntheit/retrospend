-- Lists one ALTER ... OWNER TO retrospend_owner statement for every object in
-- public and keystore that someone else owns, in an order that works: schemas,
-- tables, sequences, views, types, functions. An empty result means the
-- handover is done. scripts/db-owner runs each statement in its own
-- transaction with a short lock_timeout and retries it, so a long-running
-- query on one table delays the start instead of holding a dozen tables
-- locked behind it. Run as the superuser with search_path = pg_catalog, pg_temp.
--
-- Extension members (unaccent's function and dictionary) stay with the
-- superuser. The statements are built with format(%I), so a name with a quote
-- or a space is safe. ALTER ... OWNER keeps the ACLs, with the old owner's
-- entries moving to the new one, so retrospend_app's grants survive.
--
-- Kinds covered: schemas; tables and partitioned tables (this moves their
-- indexes, TOAST tables, row types and column-linked sequences with them,
-- including _prisma_migrations); free sequences; views, materialized views,
-- foreign tables; standalone composite types, enums, domains, ranges;
-- functions, procedures, aggregates. The catalog scan in
-- src/test/migrations/owner-role.pg.test.ts also looks at collations,
-- conversions, operators, operator classes, text search objects and extended
-- statistics, so a new kind fails CI instead of an upgrade.

WITH owner AS (
  SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'retrospend_owner'
),
schemas AS (
  SELECT oid, nspname, nspowner FROM pg_catalog.pg_namespace
   WHERE nspname IN ('public', 'keystore')
)
SELECT ddl FROM (
  SELECT 1 AS ord, s.nspname AS sch, '' AS nm,
         pg_catalog.format('ALTER SCHEMA %I OWNER TO retrospend_owner', s.nspname) AS ddl
    FROM schemas s, owner o
   WHERE s.nspowner <> o.oid

  UNION ALL
  SELECT CASE
           WHEN c.relkind IN ('r', 'p') THEN 2
           WHEN c.relkind = 'S' THEN 3
           WHEN c.relkind IN ('v', 'm', 'f') THEN 4
           ELSE 5
         END,
         s.nspname, c.relname,
         CASE c.relkind
           WHEN 'r' THEN pg_catalog.format('ALTER TABLE %I.%I OWNER TO retrospend_owner', s.nspname, c.relname)
           WHEN 'p' THEN pg_catalog.format('ALTER TABLE %I.%I OWNER TO retrospend_owner', s.nspname, c.relname)
           WHEN 'S' THEN pg_catalog.format('ALTER SEQUENCE %I.%I OWNER TO retrospend_owner', s.nspname, c.relname)
           WHEN 'v' THEN pg_catalog.format('ALTER VIEW %I.%I OWNER TO retrospend_owner', s.nspname, c.relname)
           WHEN 'm' THEN pg_catalog.format('ALTER MATERIALIZED VIEW %I.%I OWNER TO retrospend_owner', s.nspname, c.relname)
           WHEN 'f' THEN pg_catalog.format('ALTER FOREIGN TABLE %I.%I OWNER TO retrospend_owner', s.nspname, c.relname)
           WHEN 'c' THEN pg_catalog.format('ALTER TYPE %I.%I OWNER TO retrospend_owner', s.nspname, c.relname)
         END
    FROM pg_catalog.pg_class c
    JOIN schemas s ON s.oid = c.relnamespace, owner o
   WHERE c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f', 'c')
     AND c.relowner <> o.oid
     -- a sequence made by a serial or identity column follows its table
     AND NOT (c.relkind = 'S' AND EXISTS (
           SELECT 1 FROM pg_catalog.pg_depend d
            WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
              AND d.objid = c.oid AND d.deptype IN ('a', 'i')))
     AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_depend d
            WHERE d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
              AND d.objid = c.oid AND d.deptype = 'e')

  UNION ALL
  SELECT 6, s.nspname, t.typname,
         pg_catalog.format(
           CASE t.typtype WHEN 'd' THEN 'ALTER DOMAIN %I.%I OWNER TO retrospend_owner'
                          ELSE 'ALTER TYPE %I.%I OWNER TO retrospend_owner' END,
           s.nspname, t.typname)
    FROM pg_catalog.pg_type t
    JOIN schemas s ON s.oid = t.typnamespace, owner o
   WHERE t.typtype IN ('e', 'd', 'r')
     AND t.typowner <> o.oid
     AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_depend d
            WHERE d.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
              AND d.objid = t.oid AND d.deptype = 'e')

  UNION ALL
  SELECT 7, s.nspname, p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
         pg_catalog.format(
           '%s %I.%I(%s) OWNER TO retrospend_owner',
           CASE p.prokind WHEN 'p' THEN 'ALTER PROCEDURE'
                          WHEN 'a' THEN 'ALTER AGGREGATE'
                          ELSE 'ALTER FUNCTION' END,
           s.nspname, p.proname,
           CASE WHEN p.prokind = 'a'
                     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
                THEN '*'
                ELSE pg_catalog.pg_get_function_identity_arguments(p.oid) END)
    FROM pg_catalog.pg_proc p
    JOIN schemas s ON s.oid = p.pronamespace, owner o
   WHERE p.proowner <> o.oid
     AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.pg_depend d
            WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
              AND d.objid = p.oid AND d.deptype = 'e')
) work
ORDER BY ord, sch, nm;
