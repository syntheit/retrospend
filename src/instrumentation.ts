/**
 * Runs once when the Node server starts. It starts the work that belongs to
 * the server and to no request: the webhook and push workers, so deliveries
 * that were waiting when the process last stopped go out again, and the
 * hourly sweeps of expired API exports and of old support data
 * (error reports, screenshots of archived feedback), the hourly
 * auto-finalize of payments pending for 7 days, and the 15-minute auto-post
 * of due recurring items (on in production unless RECURRING_AUTO_POST says
 * otherwise). Each starts once per process and is skipped under test. First
 * it checks the server master key setting, so a malformed key stops the
 * server instead of leaving data unencrypted, then the key against the
 * canary stored in the database, so a wrong key stops it too (the first
 * start with a key writes the canary; with no key the check is skipped), and
 * then the start gates once the field encryption epoch is set, whatever the
 * flag (floor.ts: a build below the sealing floor, no master key, a lost
 * instance key). The canary comes first so a wrong key reads as
 * `master_key_mismatch`, not as a lost instance key. With DATA_KEYS_WRITE
 * on it then checks that sealing can work and sets the field encryption epoch
 * (field-encryption-start.ts), so no worker runs on a server that would
 * refuse to seal. Last it checks whether the sync log survived a restore
 * (services/sync/restore.ts) and rebuilds it when it did not.
 */
export async function register() {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;
	const { assertMasterKeyConfig } = await import("~/server/crypto/master-key");
	assertMasterKeyConfig();
	const { assertMasterKeyCanary } = await import(
		"~/server/services/keys/master-canary.service"
	);
	await assertMasterKeyCanary();
	const { assertStartGates } = await import("~/server/services/keys/floor");
	await assertStartGates();
	const { assertFieldEncryptionStart } = await import(
		"~/server/services/keys/field-encryption-start"
	);
	await assertFieldEncryptionStart();
	const { checkSyncRestore } = await import("~/server/services/sync/restore");
	await checkSyncRestore();
	const [
		{ startWebhookWorker },
		{ startPushWorker },
		{ startExportSweep },
		{ startRetentionSweep },
		{ startAutoFinalizePayments },
		{ startRecurringAutoPost },
	] = await Promise.all([
		import("~/server/services/webhooks/worker"),
		import("~/server/services/push/worker"),
		import("~/server/services/api-v1/export-sweep"),
		import("~/server/services/api-v1/retention-sweep"),
		import("~/server/services/payments/auto-finalize"),
		import("~/server/services/recurring-auto-post"),
	]);
	startWebhookWorker();
	startPushWorker();
	startExportSweep();
	startRetentionSweep();
	startAutoFinalizePayments();
	startRecurringAutoPost();
}
