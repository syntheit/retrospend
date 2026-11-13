# Encryption at rest

Retrospend can store the text people type (titles, notes, names, contact details) as ciphertext in the database. This is encrypted at rest, and the server holds the keys. It is not end-to-end encryption: the running server opens every cell it needs, so anyone who controls the server process, or holds the master key and a copy of the data, can read the text. What it does and does not protect is in the [threat model](security/threat-model.md), which is still a draft with no outside audit.

This page is for the person who runs the server. It says what is encrypted, where the keys live, what stops the server from starting and what to do about it, and the steps to turn sealing on and, if you must, back. The settings are in [self-hosting.md](self-hosting.md).

## Opening and sealing

- **Opening** is always on when a master key is set. A cell that holds ciphertext is decrypted on read, whatever the flag says. Plaintext cells read as they are.
- **Sealing** is the write side. It is on only when `DATA_KEYS_WRITE=true`. New and edited text is then stored as ciphertext. With the flag off the server writes plaintext, even on a database that already holds ciphertext.
- Turning the flag on does not rewrite old rows. A row written before stays plaintext until you edit that field, until a later backfill (D12, not built yet) seals the rest.

## What is encrypted

Only text columns, and a few JSON columns, listed in `src/server/crypto/fields.ts`. A sealed value is `U+0001`, `k1:`, then base64 of the key id, a random 12-byte nonce, the ciphertext and a 16-byte tag (AES-256-GCM). The cell's table, column, row id and key id are bound into it, so a ciphertext copied to another cell does not open.

Two key classes decide who can open a cell:

- **User key:** only that person's text. Expense title, description and location; category names; account names; transfer notes; recurring template name, payment source and website; export and import file names; the uploaded import file and its failure text; push device names; the email and phone of a person you added without an account (a ghost), which only the person who added it can read.
- **Instance key:** text that more than one person reads. Shared expense description, notes and receipt link; split rejection reasons; settlement and payment notes, methods and reasons; fix requests and replies; project names and descriptions; billing period labels; payment method labels and identifiers; a ghost's name; guest names and guest email; display names; budget book, envelope and group names, budget movement notes, envelope change previous names, income rule names and match text, wealth transfer notes; feedback and admin notes; error report messages and stacks; API key and webhook names; webhook URLs.

JSON columns:

- `idempotency_key.responseBody` (replayed API responses and undo stashes), `import_job.transactions` and `import_job.warnings` (parsed bank rows) and `feedback.diagnostics` are sealed whole.
- `audit_log_entry.changes` has only its text parts sealed (descriptions, notes, names, reasons, receipt link), so the rest stays queryable.

Also changed with this feature:

- **Contact hashes.** A ghost's or guest's email is also stored as a keyed hash (`emailHash`), because the address itself can no longer be searched once it is sealed. The hash is derived from the instance key.
- **Notices.** In-app notices and notice emails store no titles or names; they are built when read, from ids and types.
- **Import files.** The uploaded file is sealed while the job waits and is cleared by an hourly sweep once a job has been stuck for an hour.
- **Error reports** are kept 30 days, not 90.

## What is not encrypted

- **Amounts, currencies, rates, dates, ids, counts, who shares with whom, and when things happen.** The server computes every figure in SQL and in the app, so these stay plain.
- **Sign-in identity:** email address, username, sessions and IP addresses.
- **Old rows.** Anything written before the flag was turned on stays plaintext until it is edited or D12 runs. Notices, audit entries, JSON bodies, import rows, error reports and webhook URLs written earlier are in the same state.
- **Files** on the `uploads` and `exports` volumes, and avatars and project images.
- **Text in memory.** Search, title suggestions and duplicate checks open text inside the app, so the running process holds plaintext while it works.
- **Database structure and statistics,** and anything not listed above as text.

## Keys

| Key | What it is | Where it lives |
|---|---|---|
| Master key | A 256-bit key that wraps all the others, and signs a check value (the canary) | Outside the database: `DATA_MASTER_KEY` or the file `DATA_MASTER_KEY_FILE` names. No other copy exists |
| Instance key | One key for shared text, made at the first start with the flag on | `keystore.instance_text_key`, wrapped by the master key. `app_settings."instanceKeySince"` records that it was made |
| User keys | One key per person, made when a person first needs one: the category name index and category writes, and, with the flag on, before a first sealed write. They can exist before the flag is turned on | `keystore.user_data_key`, wrapped by the master key. `"user"."dataKeySince"` records that a key was made |

Where else things are recorded, all in `app_settings`: `masterKeyCanary` (a fixed text sealed under the master key, opened at every start), `fieldEncryptionSince` (the epoch, set once by the first flag-on start and never cleared) and `sealingFloor` (see [The rollback floor](#the-rollback-floor)).

- The sidecar never holds the master key. The app does all the sealing and opening.
- The `keystore` schema is left out of the main dump. The sidecar writes it as `keystore-<time>.dump` after each main backup. A keystore dump is useless without the master key.
- Keys do not rotate before D12. Keep one master key entry.
- Deleting an account destroys its user key. Its user-key text is unreadable from then on, except in older keystore backups that still hold the key. The shared (instance-key) text it wrote stays readable.

## When the server will not start

With the epoch set (sealing has been on once), the server checks the keys at every start, whether or not the flag is on, and refuses to start rather than risk making a new key that opens nothing sealed. With the flag on it checks more. Each refusal logs a code and counts, never a name, an address or an id.

The checks run in this order: the master key setting (a malformed key stops the start), the canary, the start gates (epoch set only), then the flag-on checks. The canary comes before the gates, so a wrong master key on a sealed database reads as `master_key_mismatch`, not as a lost instance key. With no master key the canary is skipped and the gates give `epoch_without_master_key`. With the right key and a lost keystore the gates give `instance_key_lost`.

| Code | When it fires | What to do |
|---|---|---|
| `sealing_unreleased` | Flag on in a production build that does not allow sealing yet | Use a build that allows it, or unset `DATA_KEYS_WRITE` |
| `master_key_missing` | Flag on, no master key set, and the epoch is not set yet | Set the master key, or unset the flag |
| `epoch_without_master_key` | The epoch is set and no master key is set, with the flag on or off | Restore the original key (or the key file) and start again. Do not start without it |
| `master_key_mismatch` | The master key does not open the stored canary or, when none is stored yet, does not open the oldest existing user key or instance key. The canary is checked before the instance key, so a wrong key gives this code, not `instance_key_lost`. The canary is never written once the epoch is set | Start with the original key. Never write a canary by hand. If that key is gone, sealed text is gone |
| `instance_key_lost` | The epoch is set and the instance key is missing from the key store, its marker is null, or the key does not open under the master key | Check the master key first. Then restore the keystore dump that matches this database dump (see [Data key backups](self-hosting.md#data-key-backups)). Do not clear the marker: a new key opens nothing sealed before |
| `keystore_grants_missing` | Flag on, and the app role cannot use the `keystore` schema or its four functions, usually after a restore | Restart: the grants are applied at every start. If it persists, the restore was not run as `retrospend_owner`; restore again as that role |
| `category_index_missing` | Flag on, and some category has no name index | Run `scripts/backfill-category-name-index.ts --apply`, then start |
| `contact_hash_missing` | Flag on, and after the start filled every plaintext address, some ghost or guest row with an address still has no hash of the current key. The log gives the table and a count | See below |
| `code_below_floor` | The database holds a higher sealing floor than this build. It is checked at every start once the epoch is set, and on a start with the flag on, including one that reads a lower floor and then finds another build raised it (a rolling deploy) | Start the build that sealed the database, or a newer one. Do not roll back below the floor |

`contact_hash_missing` means a row whose address is already sealed and has no hash. The start can fill only plaintext addresses, because a sealed one cannot be read there, and writers fail closed, so the usual cause is a restore that mixed a main dump and a keystore dump from different times. The clean fix is to restore the matching pair. The other fix is to remove the address from those rows on the owner connection: set a ghost's `email` to NULL, or delete the guest row. Take a backup first and count the rows against the log line.

One state is a warning, not a refusal. If users have `dataKeySince` set and no key row, the start logs how many. Those people read `keystore_lost`, their sealed text shows as unavailable, and every API v1 write by them fails while the flag is on, because the replay record is sealed with their key. Everyone else keeps working. Restore their keys from the matching keystore dump.

A start with the flag on also fills contact hashes itself, 500 rows at a time, before it sets the epoch. There is no script for this. The epoch is written last, so a start that refuses has not half turned sealing on.

## Turning sealing on

Two phases. Phase A is the release with the flag off. Phase B is a later restart with the flag on, done only after the checks below.

### Phase A: release with the flag off

1. Run the app and the sidecar from the same release. An older sidecar still runs its own recurring cron and would post a sealed template as ciphertext.
2. Run one app process.
3. Set `DATA_MASTER_KEY`, or `DATA_MASTER_KEY_FILE` on a mount apart from the data disk, and keep a copy in two places apart from the backup files and the data disk. Without it nothing sealed can be read, and no other copy exists.
4. Watch the log: migrations apply and the server starts. Soak for a few days. While no epoch exists, rolling the image back is safe.

### Phase B: immediately before the flag

Each step has a check. Do them in this order, on the day you turn the flag on.

1. **The release is on.** `_prisma_migrations` lists every migration up to the sealing floor migration (`20261113100000_sealing_floor`) and the build is one that allows sealing.
2. **The master key works.** Restore the latest main and keystore backups into a scratch database, start a scratch app on it with the same key, and see it start. Do not point the scratch app at production.
3. **No control characters in text.** Run `scripts/scan-control-chars.ts --fail`. It must exit 0. It exits 1 when a text column holds a control character or a value that starts with U+0001, which a sealed value would be mistaken for. It is a one-time gate: after the first sealed write it exits 1 by design.
4. **Category name index.** Run `scripts/backfill-category-name-index.ts` as a dry run, then with `--apply`.
5. **Baseline.** Run `scripts/verify-sealing.ts` and save the output. It reads only, prints counts and names, and with no epoch it prints the baseline.
6. **A fresh backup pair.** Use Back up now in the admin backups panel. Copy the new main dump and the new `keystore-<time>.dump` off the backup volume, restore the pair into the scratch database and compare row counts. Set `BACKUP_AGE_RECIPIENT` first if you have not. This pair is your way back.

The scripts run in the app container, for example `docker exec retrospend pnpm exec tsx scripts/scan-control-chars.ts --fail`, and need a `DATABASE_URL` that reads every row (the owner role, or the superuser URL the container has). The backfill also needs `AUTH_SECRET` and the master key in the environment. Prove each command on the scratch copy before you run it on production.

Then:

1. Set `DATA_KEYS_WRITE=true` and restart the app. The start checks everything, makes the instance key, fills contact hashes (a `Contact hashes filled: <table> <n>` line appears when any needed it), sets the epoch and starts listening. A refusal names its code: fix it from the table above and restart.
2. Probe: sign in, add an expense titled `sealing probe`, rename a category, add a ghost with an email.
3. Run the checks below.
4. Back up again now, with Back up now, so the keystore dump includes the instance key and every key made since. A dump older than a key loses that key and the rows sealed with it.
5. Write down today's date. The pre-flag pair is deleted 30 days from now.

### Checks after the flag is on

Run `scripts/verify-sealing.ts` right away and compare with the baseline. It reports, per text column and JSON cell, the rows holding a value, how many are sealed and how many are plaintext. It fails (exit 1) when plaintext appears in a row created after the epoch, or in a row created before it and updated after it. Plaintext in a column must never be higher than the baseline.

Once people edit old rows for other reasons (a changed amount makes `updatedAt` newer while the old title is still plaintext), the second group is expected, so run `verify-sealing.ts --created-only`. It still fails on plaintext in a row created after the epoch. Tables with no `createdAt` or `updatedAt` are listed as exceptions and are covered by the baseline comparison only.

Then, on the owner connection (read only). The commands use the container name `retrospend-postgres` and the database name `retrospend`; use your own `POSTGRES_DB_NAME` if it differs:

```sh
docker exec -i retrospend-postgres psql -U retrospend_owner -d retrospend <<'SQL'
-- epoch and floor set, instance key marker and canary present
SELECT "fieldEncryptionSince", "sealingFloor", "instanceKeySince" IS NOT NULL AS key, "masterKeyCanary" IS NOT NULL AS canary FROM app_settings;
-- exactly one instance key
SELECT count(*) FROM keystore.instance_text_key;
-- users with a key marker and no key: must be 0
SELECT count(*) FROM "user" u WHERE u."dataKeySince" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM keystore.user_data_key k WHERE k."userId" = u.id);
-- the newest expense is sealed
SELECT left("title", 4) = chr(1) || 'k1:' AS sealed FROM expense ORDER BY "createdAt" DESC LIMIT 1;
-- ghosts and guests with an address and no hash: must be 0
SELECT (SELECT count(*) FROM shadow_profile WHERE "email" IS NOT NULL AND "emailHash" IS NULL) AS ghosts, (SELECT count(*) FROM guest_session WHERE "emailHash" IS NULL) AS guests;
SQL
```

`sealingFloor` must equal the floor of the build you run. The app must show the probe expense with its plain title. The log must have no `encrypted_text_unavailable`, `auth_failed` or `keystore_lost` lines.

## Rehearsal on a scratch copy

Rehearse sealing on a scratch copy before production: restore a backup into its own database, container, network and volumes, with its own environment file and no shared backup volume, and run this whole page against it, ending with a restore of the pre-flag pair (the way back) once.

The scratch app needs the master key the copy was made under, because a copy that already holds wrapped keys and a canary refuses any other key (`master_key_mismatch`). A throwaway key works only for a copy made before any key existed. Throw the scratch copy away afterward, and never send an image from before the floor back to it.

## Turning sealing off, and the way back

- **Stop sealing:** unset `DATA_KEYS_WRITE` and restart. This is always safe. New text is stored as plaintext again, sealed rows still open, the master key must stay, and the epoch and floor stay. Plaintext written while it is off shows up as a violation in `verify-sealing.ts`.
- **There is no unseal tool.** The only way back to a database with no ciphertext is to restore the pre-flag main dump together with the pre-flag keystore dump from the same time. That loses every write since. Never restore a main dump without its matching keystore dump. Rehearse the restore once before you need it.
- **Delete the pair 30 days after the flag was turned on,** from the backup volume and from every place you copied it. Until then a deleted account's key still exists in it, so deleting that account does not yet make its text unreadable. Backups are also pruned after `BACKUP_RETENTION_DAYS` (default 30), so copy the pair out of the volume if you want it to last the full 30 days. After it is gone, the way back is gone too.
- **Lost master key or lost keystore:** the sealed text it covered is gone. The server reports that and never makes a replacement key.

## The rollback floor

`SEALING_FLOOR` in `src/server/crypto/release.ts` is a number in each build. Every start with the flag on stores the highest one seen in `app_settings."sealingFloor"`. Once the epoch is set, a build with a lower floor refuses to start (`code_below_floor`). The first floor is 1, the first release the flag can run in. A build from before the check cannot refuse itself, so after the epoch is set never deploy an image older than the release that has it.

What an older build does with sealed data, which is why the floor exists:

- Below the release that sealed JSON copies: a replayed API response returns `{ sealed }` and an undo fails.
- Below the release that opens sealed text on read: ciphertext shows as text, and the old code writes plaintext beside it.
- Below the release that sealed ghost and guest contacts: those contacts cannot claim or resume.
- Below the release that sealed webhook URLs and import files: webhooks and imports fail.

## Limits

- **One app process.** Another process can keep a person's key in memory for up to 5 minutes after it is destroyed, and can cache "epoch not set" for 30 seconds and "no instance key" for 30 seconds, so a contact hash can be missed (the next start fills it). The floor and key checks run only at start.
- **A lost user key blocks that person's writes** through API v1 while the flag is on, and their sealed text reads as unavailable, until the key is restored.
- **Stuck import files** are cleared within about two hours (an hourly sweep, a one hour cutoff), and the job shows as failed with no reason text.
- **Turkish locale.** Before the epoch, ghost email matching uses the database's case folding for plaintext, and a `tr_TR` collation can miss a dotted capital I. After the epoch the hash path is exact.
- **Contact normalization is ASCII only.** The hash folds A to Z and trims. An input path that accepts non-ASCII addresses must change the hash label and refill.
- **Contact hashes depend on the oldest (lowest id) instance key** until D12. D12 keeps that key or re-hashes every contact.
- **The contact hash links people in a dump.** One key hashes every address, so a dump without any key shows which ghosts, whoever added them, share an address, and which guest rows share one. With the instance key, a candidate address can be tested. The hash is not removed with a deleted account.
- **Mixed mode.** Until D12, a database can hold plaintext beside ciphertext. Someone who can write to the database can substitute plaintext in a row and it will be accepted, and deleting an account destroys nothing for rows that are still plaintext.
- **Escape hatches in self-hosting.md** that clear a key marker are valid only while the epoch is not set.
