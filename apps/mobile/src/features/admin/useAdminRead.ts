import type { RetrospendClient } from "@retrospend/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/auth/session";

export type AdminState<T> =
	| { status: "loading" }
	| { status: "error" }
	| { status: "ready"; data: T };

/**
 * One live read for an Admin page. It is never cached on the phone: what an
 * admin sees (accounts, emails, feedback) is not kept after the screen goes.
 * A failed reload keeps what is already on screen; `reload` reads again (after
 * a change) and `patch` edits the data in place for an answer the server just
 * gave.
 */
export function useAdminRead<T>(
	read: (api: RetrospendClient) => Promise<T>,
	key = "",
) {
	const { api } = useSession();
	const [state, setState] = useState<AdminState<T>>({ status: "loading" });
	const latest = useRef(read);
	latest.current = read;
	const alive = useRef(true);
	const sequence = useRef(0);

	const reload = useCallback(async () => {
		if (!api) return;
		// Only the newest read may answer: a slower, older one is dropped.
		const mine = ++sequence.current;
		const current = () => alive.current && mine === sequence.current;
		try {
			const data = await latest.current(api);
			if (current()) setState({ status: "ready", data });
		} catch {
			if (current()) {
				setState((prev) =>
					prev.status === "ready" ? prev : { status: "error" },
				);
			}
		}
	}, [api]);

	// A different `key` (another filter) starts from loading and reads again.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the trigger
	useEffect(() => {
		alive.current = true;
		setState({ status: "loading" });
		void reload();
		return () => {
			alive.current = false;
		};
	}, [reload, key]);

	const patch = useCallback((change: (data: T) => T) => {
		setState((prev) =>
			prev.status === "ready"
				? { status: "ready", data: change(prev.data) }
				: prev,
		);
	}, []);

	return { state, reload, patch };
}

/** What the server said went wrong, in its own words when it gave some. */
export function detailOf(error: unknown): string | null {
	const message = (error as { message?: unknown } | null)?.message;
	return typeof message === "string" && message !== "" ? message : null;
}
