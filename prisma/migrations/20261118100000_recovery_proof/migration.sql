-- The recovery proof (E2EE K1-7; plan docs/roadmap/e2ee-k1-k3.md). A person
-- who forgot the password recovers with the recovery key. The server cannot
-- check that key, so the device derives a recovery auth key from it (a
-- 256-bit value, a different subkey from the one that wraps) and sends it
-- when the keys are made. The server stores only its SHA-256 here, and a
-- later recovery proves the key by sending the same value again.
--
-- 1. "protection_key_set"."recoveryHash": nullable, because key sets made
--    before this have none (their recovery answers "unavailable" until a new
--    recovery key is made). 32 bytes when present.
-- 2. The app role may not read the column. Table-level SELECT is replaced by
--    SELECT on every other column, so a query that names the column, or reads
--    every column, fails with "permission denied" instead of returning the
--    hash (fails closed). Only the owner connection reads and writes it, in
--    the same transactions that write the set, so it moves with the set's
--    version and goes with it on delete and on account deletion. A second
--    table would need its own delete paths kept in step.
-- 3. Least privilege on the two key tables (§6.8 prune). Every writer of keys
--    (turn-on, password change, recovery, reset) runs on the owner
--    connection, so the app role loses INSERT on both tables and DELETE on
--    the wraps. It keeps the column UPDATE on the set: the vault write takes
--    the set row FOR SHARE as the app role, and Postgres needs UPDATE on at
--    least one column for that lock. It keeps SELECT on the wraps (the vault
--    write names the collection keys it holds).
--
-- Additive and idempotent: the column and constraint are guarded, REVOKE and
-- GRANT repeat safely. Rollback: prisma/rollback/20261118100000_recovery_proof.sql.

ALTER TABLE "protection_key_set" ADD COLUMN IF NOT EXISTS "recoveryHash" BYTEA;

ALTER TABLE "protection_key_set"
  DROP CONSTRAINT IF EXISTS "protection_key_set_recovery_hash_check";
ALTER TABLE "protection_key_set"
  ADD CONSTRAINT "protection_key_set_recovery_hash_check"
  CHECK ("recoveryHash" IS NULL OR octet_length("recoveryHash") = 32);

REVOKE SELECT, INSERT ON "protection_key_set" FROM retrospend_app;
GRANT SELECT (
  "userId", "kdfSalt", "kdfMemoryKiB", "kdfPasses", "publicKey", "version",
  "createdAt", "updatedAt"
) ON "protection_key_set" TO retrospend_app;

REVOKE INSERT, DELETE ON "protection_key_wrap" FROM retrospend_app;
