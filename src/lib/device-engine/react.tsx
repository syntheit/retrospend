"use client";

import { useEffect } from "react";
import { useSession } from "~/hooks/use-session";
import { deviceController } from "./instance";
import { bindTab, deviceUser } from "./wiring";

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
	const user = deviceUser(session?.user);
	const id = user?.id ?? null;
	const protectedAccount = user?.protectedAccount ?? false;

	useEffect(() => {
		if (!enabled()) return;
		deviceController().setUser(id ? { id, protectedAccount } : null);
	}, [id, protectedAccount]);

	useEffect(() => {
		if (!enabled()) return;
		return bindTab(deviceController(), document);
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
