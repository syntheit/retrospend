import { useNetworkState } from "expo-network";
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { useSession } from "@/auth/session";
import { runPoster } from "@/features/recurring/poster";
import { startPosterTask } from "@/features/recurring/posterTask";
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
 * app comes back to the foreground after a minute, never offline. After each
 * pull settles (or fails) the poster runs once, so it plans over the rows the
 * pull left; it also arms the Android background task for this account.
 */
export function useDevicePull(): void {
	const { api, local, state, baseUrl } = useSession();
	const engine = useEngine();
	const online = useNetworkState().isInternetReachable !== false;
	const meId = state.status === "signedIn" ? (state.me?.id ?? null) : null;
	const outbox = local?.outbox;
	useEffect(() => {
		if (!engine || !online) return;
		const run = new AbortController();
		const pullThenPost = () =>
			engine
				.pullIfStale()
				.catch(() => undefined)
				.then(() =>
					api && outbox && !run.signal.aborted
						? runPoster({ api, outbox, signal: run.signal })
						: undefined,
				)
				.catch(() => undefined);
		void pullThenPost();
		const subscription = AppState.addEventListener("change", (next) => {
			if (next === "active") void pullThenPost();
		});
		return () => {
			run.abort();
			subscription.remove();
		};
	}, [engine, online, api, outbox]);
	useEffect(() => {
		if (engine && baseUrl && meId)
			void startPosterTask({ baseUrl, meId }).catch(() => undefined);
	}, [engine, baseUrl, meId]);
}
