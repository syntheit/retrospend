-- ============================================================
-- Fix: Allow unauthenticated read access to PUBLIC projects
--
-- Two issues prevented publicDetail/publicListExpenses from
-- working for unauthenticated users:
--
-- 1. FORCE ROW LEVEL SECURITY on the project table made even
--    the table owner (global db connection used by publicProcedure)
--    subject to RLS. Since all policies target retrospend_app,
--    the owner role matched no policies and was denied access.
--
-- 2. The project_access RLS policy only allowed access when the
--    current user was the creator or a participant — no clause
--    for public visibility.
--
-- Fix:
--   a) Remove FORCE so the table owner bypasses RLS (standard
--      PostgreSQL behavior). This fixes publicProcedure queries.
--   b) Add a SELECT-only policy for PUBLIC projects so that
--      retrospend_app can also read them (e.g. authenticated
--      users viewing a public project they don't participate in).
-- ============================================================

-- (a) Remove FORCE ROW LEVEL SECURITY (idempotent)
ALTER TABLE "project" NO FORCE ROW LEVEL SECURITY;

-- (b) Add read-only policy for public-visibility projects
DROP POLICY IF EXISTS "project_public_read" ON "project";
CREATE POLICY "project_public_read" ON "project"
    AS PERMISSIVE FOR SELECT TO retrospend_app
    USING ("visibility" = 'PUBLIC');
