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

	return null;
}
