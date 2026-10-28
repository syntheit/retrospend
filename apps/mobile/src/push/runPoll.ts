import type { PushEnabled } from "./enabled";
import type { LocalNotification } from "./feed";
import type { Local } from "./platform";
import type { Translate } from "./texts";

// One background run: poll the feeds, post what is new. Everything it needs
// is passed in, so the real task (background.android.ts) and the tests use
// the same code.

export interface PollDeps {
	enabled(): Promise<PushEnabled | null>;
	/** What the poll found since the last run; throws when the server cannot be reached. */
	poll(enabled: PushEnabled): Promise<LocalNotification[]>;
	local: Pick<Local, "enabled" | "post" | "ensureChannels">;
	translate(): Translate;
	/** Makes the Android channels in the app's language. */
	channels(t: Translate): Parameters<Local["ensureChannels"]>[0];
	post(n: LocalNotification, t: Translate): Parameters<Local["post"]>[0];
}

/**
 * Returns how many notifications were posted. Nothing is polled while Push
 * is off or the phone blocks notifications for the app, so the cursor does
 * not run ahead of what the person could have seen.
 */
export async function runPoll(deps: PollDeps): Promise<number> {
	const enabled = await deps.enabled();
	if (!enabled || !deps.local.enabled()) return 0;
	const t = deps.translate();
	deps.local.ensureChannels(deps.channels(t));
	const found = await deps.poll(enabled);
	for (const n of found) deps.local.post(deps.post(n, t));
	return found.length;
}
