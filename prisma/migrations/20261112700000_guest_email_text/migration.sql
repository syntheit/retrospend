-- guest_session."email" holds ciphertext once field sealing is on (E2EE lane
-- D11, Revision 3, PR 4; plan docs/roadmap/e2ee-d11-rev3.md): a sealed address
-- is longer than 255 characters, so the column widens from VARCHAR(255) to
-- TEXT. The address is an instance-class cell (readable by the people who
-- see the project, and by the admin); lookups go through "emailHash"
-- (20261112200000_contact_hash), so this only widens. Binary coercible, no
-- table rewrite, idempotent. The "email" index stays until a deferred
-- migration drops it. Policy and grants are unchanged.

ALTER TABLE "guest_session" ALTER COLUMN "email" TYPE TEXT;
