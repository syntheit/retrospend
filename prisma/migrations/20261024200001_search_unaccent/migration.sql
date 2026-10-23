-- Accent-insensitive search (GET /api/v1/search). unaccent() is only
-- STABLE (its dictionary could change), so it cannot back an index or a
-- generated column; immutable_unaccent pins the dictionary and is marked
-- IMMUTABLE, the usual wrapper.
--
-- unaccent may already be installed, and not in public (some hosts keep
-- extensions in their own schema). The wrapper then calls it
-- schema-qualified from wherever it lives, and retrospend_app gets USAGE on
-- that schema so the call resolves for it. Otherwise the extension is
-- created in public: unaccent is a trusted extension (PG 13+), so a role
-- with CREATE on the database can create it without superuser.
--
-- No index yet: every search filters by user first (existing userId
-- indexes), and a substring match needs pg_trgm to use an index at all.
-- Add a trigram GIN index on immutable_unaccent(lower(col)) if per-user
-- volumes make the scan slow.

DO $migration$
DECLARE
  ext_schema text;
BEGIN
  SELECT n.nspname INTO ext_schema
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'unaccent';

  IF ext_schema IS NULL THEN
    CREATE EXTENSION unaccent WITH SCHEMA public;
    ext_schema := 'public';
  END IF;

  IF NOT has_schema_privilege('retrospend_app', ext_schema, 'USAGE') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO retrospend_app', ext_schema);
  END IF;

  -- Plain SQL with fully qualified names, so the planner can still inline it.
  EXECUTE format(
    $fn$
    CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
      RETURNS text
      LANGUAGE sql
      IMMUTABLE PARALLEL SAFE STRICT
    AS $body$ SELECT %1$I.unaccent(%2$L::regdictionary, $1) $body$
    $fn$,
    ext_schema,
    format('%I.unaccent', ext_schema)
  );
END
$migration$;

GRANT EXECUTE ON FUNCTION public.immutable_unaccent(text) TO retrospend_app;
