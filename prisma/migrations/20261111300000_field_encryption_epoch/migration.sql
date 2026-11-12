-- The field encryption epoch (E2EE lane D11, PR 4.3; plan
-- docs/roadmap/e2ee-d11-pr4.md section 3).
--
-- "fieldEncryptionSince" is set once, the first time a server starts with
-- DATA_KEYS_WRITE on (src/server/services/keys/field-encryption-start.ts), and
-- never cleared. From then on any user-text column may hold ciphertext, so
-- every server, whatever its own flag, refuses filters on those columns and
-- matches search text in the app instead of in SQL.
--
-- Same shape as "instanceKeySince" and "masterKeyCanary"
-- (20261111100000_instance_text_key): app_settings is read and written on the
-- owner connection only, and the app role has no privilege on it, so no grant
-- changes here. Additive and idempotent.

ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "fieldEncryptionSince" TIMESTAMP(3);
