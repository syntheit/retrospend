/**
 * Whether sealing user text is released for production (E2EE D11, plans
 * docs/roadmap/e2ee-d11-pr4.md section 3 and docs/roadmap/e2ee-d11-pr9.md).
 *
 * What it does: `assertFieldEncryptionStart` refuses a production start with
 * DATA_KEYS_WRITE on while it is false (`sealing_unreleased`), and
 * `sealingWanted` (sealing.ts) seals only in development and tests. Flipping
 * it enables nothing alone: DATA_KEYS_WRITE defaults to false, so a released
 * build seals nothing until the operator sets the flag.
 *
 * Preconditions for flipping it (all must be on main, in a released build):
 * - D11 PRs 1 to 8: the field map (1), the keystore, instance key and master
 *   canary (2), open-only reads (3), the seal path, flag and epoch (4.1 to
 *   4.4), search that follows the epoch (5), recurring auto-post through the
 *   app with the sidecar's cron removed (6), the opened-text cache (7), and
 *   sealed JSON copies and notices (8).
 * - Rev 3 PRs 1 (error reports, 30-day limit), 2 (webhook url), 3a (contact
 *   hash, start-up fill and gate), 3b.0 (owner column), 3b (ghost email and
 *   phone), 4 (guest email), 5 (import text) and 6 (receiptUrl). 3a and 3b
 *   must both be in: 3b changed contact normalization under hash label v1.
 * - PR 9.1 (this marker, the start gates, scripts/verify-sealing.ts and the
 *   DATA_KEYS_WRITE pass-through in the compose files), 9.2 (the sealed e2e),
 *   9.3 (the docs and the runbook) and the owner's sign-off.
 * - PR 9 notes: `SEALING_FLOOR` below is the first floor and the build that
 *   carries it is the first one the flag can run in; no database was sealed
 *   by anything older.
 */
export const SEALING_RELEASED = false;

/**
 * The rollback floor (plan docs/roadmap/e2ee-d11-pr9.md section 3). Every
 * start with DATA_KEYS_WRITE on stores it in app_settings."sealingFloor" with
 * GREATEST, and once the field encryption epoch is set a build whose floor is
 * lower refuses to start (`code_below_floor`, keys/floor.ts). Raise it only
 * in a PR that seals something older code cannot read. What an older build
 * does with sealed data:
 *   - below PR 8.1: a sealed JSON body reads as `{ sealed }` (a replayed v1
 *     response returns it, an undo fails);
 *   - below PR 3.2 (open-only reads): ciphertext shows as text, and old code
 *     writes plaintext beside it;
 *   - below Rev 3 PR 3b and 4: sealed contacts cannot claim or resume;
 *   - below Rev 3 PR 2 and 5: webhooks and imports fail.
 * An older binary cannot check a marker it does not know, so after the epoch
 * never deploy one; the first floor is the build that has this check.
 */
export const SEALING_FLOOR = 1;
