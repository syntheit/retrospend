import type { PushEnabled } from "./enabled";
import type { Poll } from "./feed";
import type { Local } from "./platform";
import type { Translate } from "./texts";

// One background run: poll the feeds, post what is new. Everything it needs
// is passed in, so the real task (background.android.ts) and the tests use
// the same code.

export interface PollDeps {
	enabled(): Promise<PushEnabled | null>;
	/**
	 * Who this phone is signed in as on that server (the cached profile), or
	 * null when nobody is. The token is kept per server, not per account.
	 */
	signedInAs(baseUrl: string): Promise<string | null>;
	/** Drops the push state of an account whose session is gone. */
	forget(enabled: PushEnabled): Promise<void>;
	/** What the poll found since the last run; throws when the server cannot be reached. */
	poll(enabled: PushEnabled): Promise<Poll>;
	local: Pick<Local, "enabled" | "post" | "ensureChannels">;
	translate(): Translate;
	/** Makes the Android channels in the app's language. */
	channels(t: Translate): Parameters<Local["ensureChannels"]>[0];
	post(
		n: Poll["notifications"][number],
		t: Translate,
	): Parameters<Local["post"]>[0];
}

/**
 * Returns how many notifications were posted. The feed cursor moves only
 * after they are posted. Nothing is polled while Push is off or the phone
 * blocks notifications for the app, so the cursor does not run ahead of what
 * the person could have seen.
 */
export async function runPoll(deps: PollDeps): Promise<number> {
	const enabled = await deps.enabled();
	if (!enabled || !deps.local.enabled()) return 0;
	// Another account (or nobody) holds this server's token now: never poll
	// its feed with this account's id and cursor.
	if ((await deps.signedInAs(enabled.baseUrl)) !== enabled.meId) {
		await deps.forget(enabled);
		return 0;
	}
	const t = deps.translate();
	deps.local.ensureChannels(deps.channels(t));
	const found = await deps.poll(enabled);
	for (const n of found.notifications) deps.local.post(deps.post(n, t));
	// Only now: a run that failed before this point reads the same events again.
	await found.commit();
	return found.notifications.length;
}
