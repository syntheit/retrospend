# Releasing

How a Retrospend version goes out. The maintainer runs every step that publishes or deploys; agents prepare the notes and the checks.

## Versions

- One version number for the whole product: the root `package.json` `version` (for example `0.5.0`). The mobile apps read it too.
- **Minor** (`0.5.0` → `0.6.0`): new features or migrations. **Patch** (`0.5.0` → `0.5.1`): fixes only.
- The mobile build number is the commit count (`git rev-list --count HEAD`). It is shown in Settings next to the version and identifies a build in bug reports.
- Tags are `v<version>` on the merge commit in `main`, for example `v0.5.0`. Older tags without the `v` stay as they are.

## Steps

1. **Freeze.** Merge the segment branches that ship into `main`. Nothing else merges until the tag.
2. **Bump** `version` in `package.json`.
3. **Gate.** On the release commit:
   - `pnpm check`, `pnpm test:pg`, `pnpm build`
   - `pnpm test:e2e` and `bash e2e/visual/run.sh`
   - `pnpm --filter @retrospend/mobile test`
   - `cd sidecar && go test ./...`
4. **Rehearse migrations** on a restored copy of a production backup, never on production itself. Note how long they take: that is the downtime.
5. **Record applied migrations.** Add the new migration folders to `src/test/migrations/applied.json`, so they can never change after they ship.
6. **Tag and push** `main` and `v<version>`.
7. **Images.** Build and push `synzeit/retrospend:<version>` and `synzeit/retrospend-sidecar:<version>`, then move `:latest` to them.
8. **GitHub release** for the tag:
   - Notes in plain words, grouped by **New**, **Fixed**, **Changed**, and **Before you update** (migrations, new settings, anything a self-hoster must do).
   - Attach the signed Android APK, so Obtainium can follow the releases.
9. **Deploy** the hosted instance: back up first, then restart on the new image. Migrations run on start.
10. **Mobile.** Upload to TestFlight and the store tracks, and publish the APK to the F-Droid repo. See `apps/mobile/README.md`.

## Release notes

Write for the people who use the app and the people who host it, not for developers. Lead with what they will notice. Every migration and every new or changed setting goes under **Before you update**, with what to do.

Agents can draft notes from `git log v<previous>..main`, but the maintainer edits and publishes them.

## Rolling back

Keep the previous image tagged before each deploy. A migration is not undone by rolling back the image: restore the backup taken in step 9 if a migration must be reversed.

Once a server has run with `DATA_KEYS_WRITE` on, never roll back to an image from before the sealing floor (`SEALING_FLOOR` in `src/server/crypto/release.ts`), and never retag an older image over `:latest` or a previous-version tag you may restart from. The server refuses to start below the floor, but an image from before the check cannot. See [encryption-at-rest.md](encryption-at-rest.md).

## Draft notes: encryption at rest

For the release that first allows `DATA_KEYS_WRITE` in production. The maintainer edits and publishes; keep the wording "encrypted at rest; the server holds the keys", never "end-to-end".

**Before you update**

- New setting `DATA_KEYS_WRITE` (default off). Nothing is sealed until you turn it on, and you should not until you have read [encryption-at-rest.md](encryption-at-rest.md). Keep the master key off the data disk and in two places.
- Before turning it on: run `scripts/scan-control-chars.ts --fail` and `scripts/backfill-category-name-index.ts --apply`, and keep a fresh main and keystore backup pair.
- The app and sidecar images must be from the same release.
- After sealing has been on, never roll back below the sealing floor. Keep the keystore backups. Keep the backup pair from just before the flag for 30 days, then delete it.
- Self-hosters on a `tr_TR` database collation: ghost email matching before the flag is on can miss a dotted capital I. Non-ASCII addresses are not supported by the contact hash.

**Changed**

- The account deletion preview in API v1 can give a null `name` and `newOrganizerName` when the server cannot open a name. The apps show "A project" or "another member".
- `shared_transaction.receiptUrl` is sealed with the other shared text. No client reads it. An older server build shows ciphertext for it.
- Error reports are kept 30 days, not 90. The first sweep deletes reports 30 to 90 days old.
- A stuck import has its file cleared within about two hours, and the job shows as failed with no reason text.
- While sealing is on, a person whose data key is lost cannot write through API v1 until it is restored, and their sealed text reads as unavailable.
- People who did not add a ghost no longer see its email or phone, and the admin ghost list shows none. An heir loses a sealed ghost email when its creator's account is deleted. Ghost emails written in mixed case now match when the person claims them.
- API v1 search cursors are ids. A cursor to a deleted row is a 400, and categories paging works the same way.
- Notices show the actor's current name, and "Someone" after that account is deleted. Old notices render in the reader's language. Guest notices change wording after 90 days.
- Shared expenses no longer route by matching category names across people.
- Recurring expenses set to pay automatically are posted by the app every 15 minutes (`RECURRING_AUTO_POST`), with the figures a manual confirm gives: half-even cents, the home leg, and a skipped post when a rate is missing.
- A webhook whose url the server cannot open fails with `url_unreadable`. Delete it and create it again.
