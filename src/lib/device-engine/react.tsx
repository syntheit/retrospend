"use client";

import type { NarrowValues, ScreenName } from "@retrospend/engine/device";
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

/**
 * A screen is open and in front: starts the worker, pulls when the last pull
 * is old, and compares this screen after a pull that brought something new.
 * `values` are what the page renders (null while it is not ready or is not
 * showing its default view). The screen keeps showing the server's numbers.
 */
export function useDeviceCompare(
	screen: ScreenName,
	values: NarrowValues | null,
) {
	// A new object with the same ids must not restart the check.
	const key = values ? JSON.stringify(values) : null;
	useEffect(() => {
		if (!enabled() || key === null) return;
		const controller = deviceController();
		void controller.screenOpened(screen, JSON.parse(key) as NarrowValues);
		return () => controller.screenClosed(screen);
	}, [screen, key]);
}
