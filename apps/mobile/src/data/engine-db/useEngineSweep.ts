import { useEffect } from "react";
import { engineScope } from "./names";
import { sweepEngineDbs } from "./sweep";

/**
 * Keeps the phone free of engine databases that are not the signed-in
 * account's. It follows the session rather than the sign-out button: the app
 * start (once the session is read), a sign-in, a sign-out and a session that
 * ended on the server (which never passes through the sign-out button) all
 * end in one of the states below, so each of them sweeps.
 *
 * Nothing is swept while the session is loading, or while an account is
 * signed in but its profile is not loaded yet (an offline start): the
 * account is not known, and sweeping then could delete its own copy.
 */
export function useEngineSweep(
	baseUrl: string | null,
	status: "loading" | "signedOut" | "signedIn",
	userId: string | null,
): void {
	useEffect(() => {
		if (status === "loading") return;
		if (status === "signedIn" && (!baseUrl || !userId)) return;
		const keep =
			status === "signedIn" && baseUrl && userId
				? engineScope(baseUrl, userId)
				: null;
		sweepEngineDbs(keep).catch(() => undefined);
	}, [baseUrl, status, userId]);
}
