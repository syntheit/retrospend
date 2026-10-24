import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { useServerConnection } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { GALLERY_ENABLED } from "@/lib/flags";
import { probeServer } from "@/lib/server-info";

// Simulator and CI runs have no one to tap through connect and sign-in. A
// build made with EXPO_PUBLIC_DEV_SERVER, EXPO_PUBLIC_DEV_EMAIL and
// EXPO_PUBLIC_DEV_PASSWORD (and EXPO_PUBLIC_GALLERY=1) runs the real connect
// and sign-in code with those values once. Release builds never set them.
const SERVER = process.env.EXPO_PUBLIC_DEV_SERVER;
const EMAIL = process.env.EXPO_PUBLIC_DEV_EMAIL;
const PASSWORD = process.env.EXPO_PUBLIC_DEV_PASSWORD;
const TOUR = process.env.EXPO_PUBLIC_DEV_TOUR;
const TOUR_STEP_MS = 12_000;

export function DevAutoSignIn() {
	const { connection, connect } = useServerConnection();
	const { state, signIn } = useSession();
	const tried = useRef({ connect: false, signIn: false });

	useEffect(() => {
		if (!GALLERY_ENABLED || !SERVER) return;
		if (connection.status === "none" && !tried.current.connect) {
			tried.current.connect = true;
			probeServer(SERVER, "99.0.0").then((result) => {
				if (result.ok) connect(result.baseUrl);
			});
		}
	}, [connection.status, connect]);

	useEffect(() => {
		if (!GALLERY_ENABLED || !EMAIL || !PASSWORD) return;
		if (
			connection.status === "connected" &&
			state.status === "signedOut" &&
			!state.expired &&
			!tried.current.signIn
		) {
			tried.current.signIn = true;
			signIn(EMAIL, PASSWORD);
		}
	}, [connection.status, state, signIn]);

	// A screenshot tour: simctl can open a custom-scheme URL only after a
	// system prompt nobody can tap, so the app walks the routes itself, one
	// every TOUR_STEP_MS after sign-in.
	const signedIn = state.status === "signedIn";
	useEffect(() => {
		if (!GALLERY_ENABLED || !TOUR || !signedIn) return;
		const timers = TOUR.split(",").map((route, index) =>
			setTimeout(
				() => router.navigate(route as never),
				(index + 1) * TOUR_STEP_MS,
			),
		);
		return () => {
			for (const timer of timers) clearTimeout(timer);
		};
	}, [signedIn]);

	return null;
}
