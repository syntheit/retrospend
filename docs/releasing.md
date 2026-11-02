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
