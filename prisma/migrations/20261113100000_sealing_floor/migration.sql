-- The sealing floor (E2EE lane D11, PR 9.1; plan docs/roadmap/e2ee-d11-pr9.md
-- section 3).
--
-- "sealingFloor" is the lowest SEALING_FLOOR (src/server/crypto/release.ts) a
-- build may have to start on a database whose field encryption epoch is set.
-- Every start with DATA_KEYS_WRITE on raises it to the build's own floor with
-- GREATEST and never lowers it, so a database sealed by a newer build refuses
-- an older one (src/server/services/keys/floor.ts). A missing app_settings row
-- or a null column reads as floor 0.
--
-- Same shape as "fieldEncryptionSince" (20261111300000): app_settings is read
-- and written on the owner connection only and the app role has no privilege
-- on it, so no grant or policy changes here. Additive and idempotent.
--
-- There is no rollback snippet on purpose. AGENTS.md section 6.3 asks for one
-- only when grants change, and a DROP COLUMN would be a floor bypass that also
-- stops every floor-aware build from reading its own marker.

ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "sealingFloor" INTEGER;
