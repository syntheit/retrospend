import { useNetworkState } from "expo-network";
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { useSession } from "@/auth/session";
import type { DeviceReads } from "./device-engine";
import { deviceEngineModule } from "./deviceEngineModule";

function useEngine() {
	const { api, local, state, baseUrl } = useSession();
	const userId = state.status === "signedIn" ? (state.me?.id ?? null) : null;
	const outbox = local?.outbox;
	return useMemo(() => {
		const module = deviceEngineModule();
		return module && api && userId
			? module.engineFor(api, userId, baseUrl, undefined, outbox)
			: null;
	}, [api, userId, baseUrl, outbox]);
}

/** What Home and Budget compare their server figures against, or null when the flag is off or nobody is signed in. */
export function useDeviceReads(): DeviceReads | null {
	return useEngine();
}

/**
 * Keeps the device's rows current: a pull when someone signs in and when the
 * app comes back to the foreground after a minute, never offline.
 */
export function useDevicePull(): void {
	const engine = useEngine();
	const online = useNetworkState().isInternetReachable !== false;
	useEffect(() => {
		if (!engine || !online) return;
		engine.pullIfStale();
		const subscription = AppState.addEventListener("change", (next) => {
			if (next === "active") engine.pullIfStale();
		});
		return () => subscription.remove();
	}, [engine, online]);
}
