import { useNetworkState } from "expo-network";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useSession } from "@/auth/session";
import { flushOutbox } from "@/data/sync";
import { announceEntryChange } from "./events";
import { createEntrySender, entryOutbox } from "./send";

/**
 * Sends what waits in the outbox: when the app opens, when it comes back to
 * the foreground and when the network returns. A write added offline thus
 * reaches the server without anyone opening the composer again. Entries of
 * other kinds stay where they are until their own sender exists.
 */
export function useOutboxFlush(): void {
	const { api, local } = useSession();
	const online = useNetworkState().isInternetReachable !== false;

	useEffect(() => {
		if (!api || !local || !online) return;
		const flush = async () => {
			const report = await flushOutbox(
				entryOutbox(local.outbox),
				createEntrySender(api),
			);
			if (report.sent > 0) announceEntryChange();
		};
		flush();
		const subscription = AppState.addEventListener("change", (next) => {
			if (next === "active") flush();
		});
		return () => subscription.remove();
	}, [api, local, online]);
}
