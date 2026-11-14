import { useNetworkState } from "expo-network";
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { useSession } from "@/auth/session";
import type * as DeviceEngineModule from "./device-engine";
import type { DeviceReads } from "./device-engine";

/**
 * The dev flag EXPO_PUBLIC_DEV_DEVICE_ENGINE=1 (a DEV_ variable, so a release
 * build refuses it). The engine is required only when it is set: Metro folds
 * the variable, so every other build leaves the engine and its package out of
 * the bundle (scripts/check-release-bundle.sh). Without the flag both hooks
 * do nothing.
 */
function deviceEngineModule(): typeof DeviceEngineModule | null {
	return process.env.EXPO_PUBLIC_DEV_DEVICE_ENGINE === "1"
		? require("./device-engine")
		: null;
}

function useEngine() {
	const { api, state } = useSession();
	const userId = state.status === "signedIn" ? (state.me?.id ?? null) : null;
	return useMemo(() => {
		const module = deviceEngineModule();
		return module && api && userId ? module.engineFor(api, userId) : null;
	}, [api, userId]);
}

/** What Home reads figures from, or null when the flag is off or nobody is signed in. */
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
