import type { RetrospendClient } from "@retrospend/api-client";
import type { KeyValueStore } from "@/data/store";
import { apns } from "./apns";
import { startPolling, stopPolling } from "./background";
import { createEnabledStore, type PushEnabled, pushScope } from "./enabled";
import { createFeedState } from "./feed";
import { PUSH_CHANNELS } from "./kinds";
import { local } from "./local";
import {
	createRegistrationStore,
	type DeviceInfo,
	syncRegistration,
	unregister,
} from "./registration";
import { channelDefs, makeTranslator } from "./texts";

// Turning Push on and off for this phone, and keeping it on across launches.
// Plain functions over an injected store and API so the order of the steps
// (permission, then token, then server, then the switch) can be tested.

export type EnableResult = "on" | "denied" | "unavailable";

export interface PushControl {
	/** Whether this phone can receive anything: iOS (APNs) or Android (local). */
	supported: boolean;
	permission(): Promise<"granted" | "denied" | "undetermined">;
	enable(): Promise<EnableResult>;
	disable(): Promise<void>;
	/** App start and resume: re-register (iOS) or restart the poll (Android). */
	refresh(): Promise<void>;
	/** A new APNs token arrived: register it when Push is on. */
	registerToken(token: string): Promise<void>;
	/** Stops everything locally without telling the server (session ended). */
	forget(): Promise<void>;
}

export function createPushControl(args: {
	store: KeyValueStore;
	api: Pick<RetrospendClient, "push"> | null;
	who: PushEnabled;
	sandbox: boolean;
	device?: DeviceInfo;
}): PushControl {
	const { store, api, who, sandbox, device } = args;
	const scope = pushScope(who);
	const enabled = createEnabledStore(store);
	const registration = createRegistrationStore(store, scope);
	const feed = createFeedState(store, scope);

	async function register(token: string) {
		if (!api) return;
		await syncRegistration({
			api: api.push,
			store: registration,
			token,
			sandbox,
			device,
		});
	}

	async function forget() {
		await Promise.all([
			enabled.clear(),
			registration.clear(),
			feed.clear(),
			stopPolling().catch(() => undefined),
		]);
	}

	return {
		supported: apns.supported || local.supported,
		permission: async () =>
			apns.supported
				? apns.permission()
				: local.enabled()
					? "granted"
					: "undetermined",
		async enable() {
			if (apns.supported) {
				if ((await apns.requestPermission()) !== "granted") return "denied";
				const token = await apns.deviceToken();
				if (!token) return "unavailable";
				await apns.setupCategories([...PUSH_CHANNELS]);
				await register(token);
			} else if (local.supported) {
				if (!(await local.requestPermission())) return "denied";
				local.ensureChannels(channelDefs(makeTranslator()));
				await startPolling();
			} else {
				return "unavailable";
			}
			await enabled.set(who);
			return "on";
		},
		async disable() {
			await unregister({ api: api?.push ?? null, store: registration });
			await Promise.all([
				enabled.clear(),
				feed.clear(),
				stopPolling().catch(() => undefined),
			]);
		},
		async refresh() {
			const current = await enabled.get();
			if (
				current &&
				current.baseUrl === who.baseUrl &&
				current.meId !== who.meId
			) {
				// Another account on this server left Push on and its session is
				// gone: nothing of it carries over to the one signed in now.
				await forgetServerPush(store, who.baseUrl, null);
				return;
			}
			if (!current || pushScope(current) !== scope) return;
			if (apns.supported) {
				if ((await apns.permission()) !== "granted") return;
				await apns.setupCategories([...PUSH_CHANNELS]);
				const token = await apns.deviceToken();
				if (token) await register(token);
			} else if (local.supported && local.enabled()) {
				local.ensureChannels(channelDefs(makeTranslator()));
				await startPolling();
			}
		},
		async registerToken(token) {
			const current = await enabled.get();
			if (current && pushScope(current) === scope) await register(token);
		},
		forget,
	};
}

/**
 * A session on this server ended (sign-out elsewhere, expiry, another
 * account signing in): drop the push state of `meId` and of whichever
 * account on this server has Push on, and stop the poll that would run for
 * it. Works without knowing who was signed in, so a session that ended
 * before the app opened leaves nothing behind.
 */
export async function forgetServerPush(
	store: KeyValueStore,
	baseUrl: string,
	meId: string | null,
): Promise<void> {
	const enabled = createEnabledStore(store);
	const current = await enabled.get();
	const onHere = current?.baseUrl === baseUrl ? current : null;
	const scopes = new Set<string>();
	if (meId) scopes.add(pushScope({ baseUrl, meId }));
	if (onHere) scopes.add(pushScope(onHere));
	await Promise.all(
		[...scopes].flatMap((scope) => [
			createRegistrationStore(store, scope).clear(),
			createFeedState(store, scope).clear(),
		]),
	);
	if (onHere) {
		await Promise.all([enabled.clear(), stopPolling().catch(() => undefined)]);
	}
}
