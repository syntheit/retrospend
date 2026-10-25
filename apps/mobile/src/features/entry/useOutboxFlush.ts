import { useNetworkState } from "expo-network";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useToast } from "@/ui/Toast";
import { announceEntryChange } from "./events";
import { flushEntries } from "./queue";

/**
 * Sends what waits in the outbox: when the app opens, when it comes back to
 * the foreground and when the network returns. A write added offline thus
 * reaches the server without anyone opening the composer again. A flush that
 * parks a write says so, since nobody is looking at the composer. Entries of
 * other kinds stay where they are until their own sender exists. When the
 * account changes the run stops: nothing of the old account is sent after.
 */
export function useOutboxFlush(): void {
	const t = useTranslations("mobile.entry");
	const toast = useToast();
	const { api, local } = useSession();
	const online = useNetworkState().isInternetReachable !== false;

	useEffect(() => {
		if (!api || !local || !online) return;
		const run = new AbortController();
		const flush = async () => {
			const report = await flushEntries(local.outbox, api, {
				signal: run.signal,
			});
			if (run.signal.aborted) return;
			if (report.sent > 0 || report.conflicts > 0) announceEntryChange();
			if (report.conflicts > 0) {
				toast.show({
					message: t("toast.parkedBackground", { count: report.conflicts }),
				});
			}
		};
		flush();
		const subscription = AppState.addEventListener("change", (next) => {
			if (next === "active") flush();
		});
		return () => {
			run.abort();
			subscription.remove();
		};
	}, [api, local, online, toast, t]);
}
