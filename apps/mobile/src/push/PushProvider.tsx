import Constants from "expo-constants";
import { useRouter } from "expo-router";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { AppState, Platform } from "react-native";
import { useServerConnection } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { createSqliteStore } from "@/data/sqlite-store";
import { apns } from "./apns";
import { createPushControl, type EnableResult } from "./control";
import { createEnabledStore, pushScope } from "./enabled";
import { parsePushPayload, routeFor } from "./kinds";

// Push for the signed-in account, for the screens that show or change it.
// Keeping it alive across launches (registering the iOS token again, taps
// that open a screen) happens here; the Android poll is a background task
// (background.android.ts) and needs no component.

const store = createSqliteStore();

interface PushValue {
	/** iOS (APNs) or Android (local notifications): false means no Push section. */
	supported: boolean;
	/** Push is on for this phone and this account. */
	on: boolean;
	enable(): Promise<EnableResult>;
	disable(): Promise<void>;
}

const PushContext = createContext<PushValue | null>(null);

/** Which APNs host this build's tokens belong to (app.config.ts). */
function sandboxBuild(): boolean {
	return Constants.expoConfig?.extra?.apnsSandbox === true;
}

export function PushProvider({ children }: { children: ReactNode }) {
	const { connection } = useServerConnection();
	const { state, api } = useSession();
	const router = useRouter();
	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;
	const meId = state.status === "signedIn" ? (state.me?.id ?? null) : null;
	const [on, setOn] = useState(false);

	const control = useMemo(
		() =>
			baseUrl && meId
				? createPushControl({
						store,
						api,
						who: { baseUrl, meId },
						sandbox: sandboxBuild(),
						device: {
							appVersion: Constants.expoConfig?.version,
							deviceName:
								Platform.OS === "ios" && Platform.isPad ? "iPad" : undefined,
						},
					})
				: null,
		[baseUrl, meId, api],
	);

	// Whether Push is on, and a fresh registration (or poll) at every start
	// and every return to the app.
	useEffect(() => {
		if (!control || !baseUrl || !meId) {
			setOn(false);
			return;
		}
		let alive = true;
		const refresh = async () => {
			const who = await createEnabledStore(store).get();
			const here = who
				? pushScope(who) === pushScope({ baseUrl, meId })
				: false;
			if (alive) setOn(here);
			await control.refresh().catch(() => undefined);
		};
		refresh();
		const sub = AppState.addEventListener("change", (s) => {
			if (s === "active") refresh();
		});
		return () => {
			alive = false;
			sub.remove();
		};
	}, [control, baseUrl, meId]);

	// iOS: a new token reaches the server, a tap opens the screen it is about.
	useEffect(() => {
		if (!control || !apns.supported) return;
		const offToken = apns.onTokenChange((token) => {
			control.registerToken(token).catch(() => undefined);
		});
		const offTap = apns.onTap((raw) => {
			const payload = parsePushPayload(raw);
			// Next tick: a cold start taps before the signed-in screens mount.
			if (payload) setTimeout(() => router.navigate(routeFor(payload.type)), 0);
		});
		return () => {
			offToken();
			offTap();
		};
	}, [control, router]);

	const enable = useCallback(async (): Promise<EnableResult> => {
		if (!control) return "unavailable";
		const result = await control.enable();
		setOn(result === "on");
		return result;
	}, [control]);

	const disable = useCallback(async () => {
		await control?.disable();
		setOn(false);
	}, [control]);

	const value = useMemo<PushValue>(
		() => ({ supported: control?.supported ?? false, on, enable, disable }),
		[control, on, enable, disable],
	);
	return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

export function usePush(): PushValue {
	const value = useContext(PushContext);
	if (!value) throw new Error("usePush needs a PushProvider above it");
	return value;
}
