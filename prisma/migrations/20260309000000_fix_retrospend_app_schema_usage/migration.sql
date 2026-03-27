-- ============================================================
-- Fix: Grant USAGE on schema public to retrospend_app
--
-- The original RLS migration granted table-level privileges but
-- omitted GRANT USAGE ON SCHEMA public, which PostgreSQL requires
-- before a role can access any object in the schema.
-- Without it, SET ROLE retrospend_app followed by any query
-- produces "permission denied for schema public".
--
-- Also re-grant table privileges to catch any tables created
-- by migrations that ran after the ALTER DEFAULT PRIVILEGES was set.
-- ============================================================

-- Schema-level access (the missing piece)
GRANT USAGE ON SCHEMA public TO retrospend_app;

-- Re-grant on all tables to cover any created after the original
-- ALTER DEFAULT PRIVILEGES was configured.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO retrospend_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO retrospend_app;
