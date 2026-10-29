import type { RetrospendClient } from "@retrospend/api-client";
import { useEffect, useState } from "react";
import { useSession } from "@/auth/session";

export type SheetRead<T> =
	| { status: "idle" | "loading" | "error" }
	| { status: "ready"; data: T };

/**
 * A read a sheet needs when it opens (accounts, owed, a draft). Each opening
 * reads again, so a sheet never shows what was true the last time. `load` is
 * rebuilt every render; only `visible` and `reload` start a read. Data read
 * for another `when` reads as loading, so a write never starts from it.
 */
export function useSheetRead<T>(
	visible: boolean,
	load: (api: RetrospendClient) => Promise<T>,
	/** Anything the read depends on besides `visible`: a change reads again. */
	when = "",
): SheetRead<T> & { reload: () => void } {
	const { api } = useSession();
	const [state, setState] = useState<SheetRead<T> & { when?: string }>({
		status: "idle",
	});
	const [again, setAgain] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `load` changes every render; `api` is stable for a session
	useEffect(() => {
		if (!visible || !api) return;
		let cancelled = false;
		setState({ status: "loading" });
		load(api).then(
			(data) => {
				if (!cancelled) setState({ status: "ready", data, when });
			},
			() => {
				if (!cancelled) setState({ status: "error" });
			},
		);
		return () => {
			cancelled = true;
		};
	}, [visible, api, again, when]);
	const reload = () => setAgain((n) => n + 1);
	if (state.status === "ready" && state.when !== when)
		return { status: "loading", reload };
	if (state.status === "ready")
		return { status: "ready", data: state.data, reload };
	return { status: state.status, reload };
}
