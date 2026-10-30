import { useEffect } from "react";
import { AppState } from "react-native";
import { useSession } from "@/auth/session";
import { flushErrorReports } from "./flush";
import { useErrorReportsPref } from "./pref";
import { getErrorLog } from "./runtime";

/** How long after an error to wait before sending, so a burst goes as one batch. */
const SETTLE_MS = 2000;

/**
 * Renders nothing. While the switch is on and someone is signed in, it sends
 * queued error reports when the app opens, comes to the foreground, the
 * switch is turned on, and shortly after each new error. With the switch off
 * it does nothing at all.
 */
export function ErrorReportsFlusher() {
	const { api } = useSession();
	const on = useErrorReportsPref();

	useEffect(() => {
		if (!on || !api) return;
		const log = getErrorLog();
		let timer: ReturnType<typeof setTimeout> | null = null;
		const send = () => void flushErrorReports(log, api);
		send();
		const stop = log.subscribe(() => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(send, SETTLE_MS);
		});
		const app = AppState.addEventListener("change", (state) => {
			if (state === "active") send();
		});
		return () => {
			stop();
			app.remove();
			if (timer) clearTimeout(timer);
		};
	}, [on, api]);

	return null;
}
