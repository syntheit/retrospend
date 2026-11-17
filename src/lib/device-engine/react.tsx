"use client";

import { useEffect } from "react";
import { useSession } from "~/hooks/use-session";
import { deviceController } from "./instance";

// All of it is inert without the dev flag: the checks below are the literal
// the build replaces, so nothing is created and nothing starts.
const enabled = () => process.env.NEXT_PUBLIC_DEV_DEVICE_ENGINE === "1";

/**
 * Keeps the device worker's account and tab in step with the page. Mounted
 * once in the dashboard layout, so leaving it (sign-out lands on the login
 * page) ends the worker, and so does another account or a null session.
 */
export function DeviceEngineLifecycle() {
	const { data: session } = useSession();
	const id = session?.user.id ?? null;
	// A field the session carries at run time but the client's types do not name.
	const protectedAccount =
		(session?.user as { protectionState?: string } | undefined)
			?.protectionState === "ON";

	useEffect(() => {
		if (!enabled()) return;
		deviceController().setUser(id ? { id, protectedAccount } : null);
	}, [id, protectedAccount]);

	useEffect(() => {
		if (!enabled()) return;
		const controller = deviceController();
		const onVisible = () => {
			if (document.visibilityState === "visible") void controller.tabVisible();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			document.removeEventListener("visibilitychange", onVisible);
			controller.setUser(null);
		};
	}, []);

	return null;
}

/** Home is open: starts the worker and pulls when the last pull is old. */
export function useDevicePullOnHome() {
	useEffect(() => {
		if (!enabled()) return;
		const controller = deviceController();
		void controller.homeOpened();
		return () => controller.homeClosed();
	}, []);
}
