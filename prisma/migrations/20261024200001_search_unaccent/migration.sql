-- Accent-insensitive search (GET /api/v1/search). unaccent() is only
-- STABLE (its dictionary could change), so it cannot back an index or a
-- generated column; immutable_unaccent pins the dictionary and is marked
-- IMMUTABLE, the usual wrapper. unaccent is a trusted extension (PG 13+),
-- so the database owner can create it without superuser.
--
-- No index yet: every search filters by user first (existing userId
-- indexes), and a substring match needs pg_trgm to use an index at all.
-- Add a trigram GIN index on immutable_unaccent(lower(col)) if per-user
-- volumes make the scan slow.

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

GRANT EXECUTE ON FUNCTION public.immutable_unaccent(text) TO retrospend_app;
