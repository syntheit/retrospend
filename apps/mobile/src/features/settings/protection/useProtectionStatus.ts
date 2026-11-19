import type { RetrospendClient } from "@retrospend/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { statusOf } from "@/auth/sign-in-secret";

/**
 * What the Security row shows. `hidden` is the state until the server has said
 * it offers Advanced protection (and stays when it does not, or cannot be
 * asked): the row fails closed. Then `loading` the keys status, and the answer.
 */
export type ProtectionStatus =
	| "hidden"
	| "loading"
	| "error"
	| "none"
	| "keyed";

/** The two reads the row needs: the server's flag, then whether this account has keys (404 when it has none). */
export type StatusApi = {
	platform: Pick<RetrospendClient["platform"], "serverInfo">;
	protection: Pick<RetrospendClient["protection"], "keys">;
};

/** Reads the status, reporting `loading` once the flag says protection is offered. */
export async function readProtectionStatus(
	api: StatusApi,
	onOffered: () => void,
): Promise<ProtectionStatus> {
	try {
		const info = await api.platform.serverInfo();
		if (info.features.advancedProtection !== true) return "hidden";
	} catch {
		return "hidden";
	}
	onOffered();
	try {
		await api.protection.keys();
		return "keyed";
	} catch (error) {
		return statusOf(error) === 404 ? "none" : "error";
	}
}

/** The row's status for the signed-in account, and a way to read it again (after the sheet closes, or Try again). */
export function useProtectionStatus(api: StatusApi | null) {
	const [status, setStatus] = useState<ProtectionStatus>("hidden");
	const run = useRef(0);
	const reload = useCallback(async () => {
		if (!api) return setStatus("hidden");
		const mine = ++run.current;
		const settle = (next: ProtectionStatus) => {
			if (run.current === mine) setStatus(next);
		};
		settle(await readProtectionStatus(api, () => settle("loading")));
	}, [api]);
	useEffect(() => {
		void reload();
		return () => {
			// An answer for an account or a screen that is gone lands nowhere.
			run.current += 1;
		};
	}, [reload]);
	return { status, reload };
}
