import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useServerConnection } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { probeServer } from "@/lib/server-info";
import { type E2eSession, parseE2eLink } from "./e2eSession";

// End-to-end runs (Maestro) install one build and point it at a different
// throwaway server each run, so they cannot bake credentials in the way
// DevAutoSignIn does. They open retrospend://__e2e/session?... instead. This
// runs the real connect and sign-in code, only for a server on the e2e
// allowlist, and never logs the password. The build profile guard
// (app.config.ts) and scripts/check-release-bundle.sh keep it out of every
// release, TestFlight and F-Droid build.
export function E2eLink() {
	const { connection, connect } = useServerConnection();
	const { state, signIn } = useSession();
	const [pending, setPending] = useState<E2eSession | null>(null);
	const tried = useRef({ connect: false, signIn: false });

	useEffect(() => {
		function take(url: string | null) {
			const session = url ? parseE2eLink(url) : null;
			if (!session) return;
			tried.current = { connect: false, signIn: false };
			setPending(session);
		}
		Linking.getInitialURL().then(take);
		const subscription = Linking.addEventListener("url", (event) =>
			take(event.url),
		);
		return () => subscription.remove();
	}, []);

	useEffect(() => {
		if (!pending || connection.status !== "none" || tried.current.connect) {
			return;
		}
		tried.current.connect = true;
		probeServer(pending.server, "99.0.0").then((result) => {
			if (result.ok) connect(result.baseUrl);
		});
	}, [pending, connection.status, connect]);

	useEffect(() => {
		if (
			!pending ||
			connection.status !== "connected" ||
			state.status !== "signedOut" ||
			tried.current.signIn
		) {
			return;
		}
		tried.current.signIn = true;
		signIn(pending.email, pending.password);
	}, [pending, connection.status, state.status, signIn]);

	const signedIn = state.status === "signedIn";
	useEffect(() => {
		if (!pending || !signedIn) return;
		if (pending.route) router.navigate(pending.route as never);
		setPending(null);
	}, [pending, signedIn]);

	return null;
}

// scripts/check-release-bundle.sh greps for this name: it must not appear in
// a release bundle.
E2eLink.displayName = "RetrospendE2eLink";
