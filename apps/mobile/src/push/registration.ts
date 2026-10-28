import type { RetrospendClient } from "@retrospend/api-client";
import type { KeyValueStore } from "@/data/store";

// Telling the server where this phone can be pushed (iOS: the APNs device
// token). The server upserts on the address, so registering on every app
// start is cheap and keeps lastSeenAt fresh. The id the server gave the
// device is kept so a token change, or turning push off, removes the old
// row instead of leaving a dead address behind.

export interface Registration {
	deviceId: string;
	token: string;
	sandbox: boolean;
}

export interface DeviceInfo {
	appVersion?: string;
	deviceName?: string;
}

type PushApi = Pick<RetrospendClient["push"], "register" | "remove">;

const KEY = "push.registration";

export function createRegistrationStore(store: KeyValueStore, scope: string) {
	const key = `${KEY}.${scope}`;
	return {
		async get(): Promise<Registration | null> {
			const raw = await store.get(key);
			if (!raw) return null;
			try {
				const v = JSON.parse(raw) as Partial<Registration>;
				return typeof v.deviceId === "string" && typeof v.token === "string"
					? { deviceId: v.deviceId, token: v.token, sandbox: !!v.sandbox }
					: null;
			} catch {
				return null;
			}
		},
		set: (value: Registration) => store.set(key, JSON.stringify(value)),
		clear: () => store.delete(key),
	};
}
export type RegistrationStore = ReturnType<typeof createRegistrationStore>;

/**
 * Registers the APNs token. Always sends it (an upsert, and the server's
 * lastSeenAt); when the token or the APNs environment changed, the device
 * row registered before is removed, best effort. `sandbox` is true only for
 * Xcode debug builds: TestFlight and App Store builds use production APNs.
 */
export async function syncRegistration(args: {
	api: PushApi;
	store: RegistrationStore;
	token: string;
	sandbox: boolean;
	device?: DeviceInfo;
}): Promise<Registration> {
	const { api, store, token, sandbox, device } = args;
	const previous = await store.get();
	const row = await api.register({
		transport: "apns",
		platform: "ios",
		token,
		apnsSandbox: sandbox,
		...(device?.appVersion ? { appVersion: device.appVersion } : {}),
		...(device?.deviceName ? { deviceName: device.deviceName } : {}),
	});
	const next = { deviceId: row.id, token, sandbox };
	await store.set(next);
	if (previous && previous.deviceId !== row.id) {
		await api.remove({ id: previous.deviceId }).catch(() => undefined);
	}
	return next;
}

/**
 * Stops pushing to this phone: signing out, or the Push switch turned off.
 * The server row goes first; the local record goes even when the call fails
 * (offline), because the server also drops a row whose session is gone.
 */
export async function unregister(args: {
	api: PushApi | null;
	store: RegistrationStore;
}): Promise<void> {
	const current = await args.store.get();
	if (current && args.api) {
		await args.api.remove({ id: current.deviceId }).catch(() => undefined);
	}
	await args.store.clear();
}
