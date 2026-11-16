-- The sealed record store (E2EE F7a; plan docs/roadmap/e2ee-f7a.md): what the
-- server holds of a protected account's data. One row per record, the bytes a
-- client sealed (packages/crypto format.ts) and the plain facts the server
-- may know under spike 2.4: the record's id, its collection, its entity
-- number, its version and the times it was written. It never opens a record.
--
-- 1. "vault_record": primary key (userId, id), so one user's client-made ids
--    never meet another's. The CHECKs pin the format the clients seal, so a
--    format change needs a migration on purpose: a live record is at least
--    122 bytes (the 58 of header and tag plus one 64-byte bucket), aligned to
--    64 after the 58, at most 1 MiB of plaintext, and starts 01 01 (format
--    version, algorithm). A tombstone has no ciphertext (erasure) and a live
--    record always has one.
-- 2. Commit order, the device sync feed's method (20261114100000_sync_change):
--    "txid" is the writing transaction and "seq" a global sequence. A reader
--    only sees rows whose txid is below the oldest open transaction, so a
--    write that commits late never lands behind a cursor a client holds.
--    Every write sets both again, so a rewritten record moves to the end.
-- 3. vault_record_stamp(): a BEFORE INSERT OR UPDATE trigger that sets txid,
--    seq and updatedAt whatever the caller sent. SECURITY DEFINER so the app
--    role needs no USAGE on the sequence and no UPDATE on those three columns:
--    nothing a user-scoped path can send makes a row sort before another or
--    look older than it is. "seq" has no column default for the same reason
--    (a default's nextval runs as the caller).
--
-- Row-level security is ENABLE, not FORCE: the owner connection writes this
-- table too (turning protection on and off, reset), so it must keep bypassing
-- the policy, as on sync_change and the key tables. Only retrospend_app is
-- bound by it, to the caller's own rows.
--
-- Grants are the narrowest a user-scoped path uses: read and insert, and
-- UPDATE of the three columns a write changes. A record never moves (its
-- collection and entity are fixed) and the app role cannot delete: erasing a
-- store is data deletion, decided on the owner connection (K10, K11).
-- Additive and idempotent.

CREATE SEQUENCE IF NOT EXISTS "vault_record_seq";

CREATE TABLE IF NOT EXISTS "vault_record" (
  "userId"       TEXT         NOT NULL,
  "id"           TEXT         NOT NULL,
  "collectionId" TEXT         NOT NULL,
  "entity"       INTEGER      NOT NULL,
  "version"      INTEGER      NOT NULL,
  "ciphertext"   BYTEA,
  "deletedAt"    TIMESTAMP(3),
  "txid"         xid8         NOT NULL DEFAULT pg_current_xact_id(),
  "seq"          BIGINT       NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vault_record_pkey" PRIMARY KEY ("userId", "id"),
  CONSTRAINT "vault_record_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "vault_record_id_check" CHECK ("id" ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT "vault_record_collection_check" CHECK ("collectionId" ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- The AAD allows 0xffff (format.ts recordAad); 0 is never an entity.
  CONSTRAINT "vault_record_entity_check" CHECK ("entity" BETWEEN 1 AND 65535),
  CONSTRAINT "vault_record_version_check" CHECK ("version" >= 1),
  -- substring is safe on a short value, where get_byte would raise.
  CONSTRAINT "vault_record_ciphertext_check" CHECK (
    "ciphertext" IS NULL OR (
      octet_length("ciphertext") BETWEEN 122 AND 58 + 1048576
      AND (octet_length("ciphertext") - 58) % 64 = 0
      AND substring("ciphertext" from 1 for 2) = '\x0101'::bytea
    )
  ),
  CONSTRAINT "vault_record_tombstone_check" CHECK (("deletedAt" IS NULL) = ("ciphertext" IS NOT NULL))
);

ALTER SEQUENCE "vault_record_seq" OWNED BY "vault_record"."seq";

CREATE INDEX IF NOT EXISTS "vault_record_userId_txid_seq_idx"
  ON "vault_record"("userId", "txid", "seq");

CREATE OR REPLACE FUNCTION vault_record_stamp() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW."txid" := pg_current_xact_id();
  NEW."seq" := nextval('vault_record_seq');
  NEW."updatedAt" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vault_record_stamp ON "vault_record";
CREATE TRIGGER vault_record_stamp
  BEFORE INSERT OR UPDATE ON "vault_record"
  FOR EACH ROW EXECUTE FUNCTION vault_record_stamp();

ALTER TABLE "vault_record" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vault_record_own ON "vault_record";
CREATE POLICY vault_record_own ON "vault_record"
  AS PERMISSIVE FOR ALL TO retrospend_app
  USING ("userId" = current_setting('app.current_user_id', TRUE))
  WITH CHECK ("userId" = current_setting('app.current_user_id', TRUE));

GRANT SELECT, INSERT ON "vault_record" TO retrospend_app;
GRANT UPDATE ("ciphertext", "version", "deletedAt") ON "vault_record" TO retrospend_app;
