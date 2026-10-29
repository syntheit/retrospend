import type { RetrospendClient } from "@retrospend/api-client";
import { useNetworkState } from "expo-network";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import { type CatalogState, loadEntryCatalog } from "./catalog";
import type { PendingWrite } from "./draft";
import { fetchPreview, type PreviewState } from "./preview";

/** Categories, people and currencies: cached first, then fresh. */
export function useEntryCatalog(): CatalogState {
	const { api, local, state } = useSession();
	const me = state.status === "signedIn" ? state.me : null;
	const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
	const home = me?.homeCurrency;
	const fallback = me?.defaultCurrency;

	useEffect(() => {
		if (!api || !local || !home || !fallback) {
			setCatalog({ status: "error" });
			return;
		}
		let cancelled = false;
		loadEntryCatalog(
			api,
			local.cache,
			{ homeCurrency: home, defaultCurrency: fallback },
			(cached) => {
				if (!cancelled) setCatalog(cached);
			},
		).then((next) => {
			if (!cancelled) setCatalog(next);
		});
		return () => {
			cancelled = true;
		};
	}, [api, local, home, fallback]);

	return catalog;
}

const PREVIEW_DELAY_MS = 350;

/**
 * The server's dry run of `write`, asked 350 ms after the last change so
 * typing an amount does not send a request per key. The answer is kept with
 * the body it was for: a preview of an older body never shows as current, so
 * Save can wait for the preview of what it is about to send. A dry run that
 * could not reach the server is asked again when the network returns, and
 * `retry` asks again on request (after a refusal too).
 */
export function useEntryPreview(write: PendingWrite | null): {
	state: PreviewState;
	retry: () => void;
} {
	const { api } = useSession();
	const online = useNetworkState().isInternetReachable !== false;
	const [attempt, setAttempt] = useState(0);
	const [kept, setKept] = useState<{
		signature: string;
		attempt: number;
		state: PreviewState;
	}>({ signature: "", attempt: 0, state: { status: "idle" } });
	// A new object every render, but the same text while nothing changed.
	const signature = write
		? `${write.entity}:${write.kind ?? "create"}:${JSON.stringify(write.body)}`
		: "";
	const state: PreviewState = !write
		? { status: "idle" }
		: kept.signature === signature && kept.attempt === attempt
			? kept.state
			: { status: "loading" };
	const retry = useCallback(() => setAttempt((n) => n + 1), []);

	// Back online: an offline answer is asked again.
	const wasOffline = useRef(false);
	wasOffline.current = state.status === "offline";
	useEffect(() => {
		if (online && wasOffline.current) retry();
	}, [online, retry]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `write` is read through `signature`; `attempt` asks again
	useEffect(() => {
		if (!api || !write) return;
		let cancelled = false;
		const timer = setTimeout(() => {
			fetchPreview(api, write).then((next) => {
				if (!cancelled) setKept({ signature, attempt, state: next });
			});
		}, PREVIEW_DELAY_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [api, signature, attempt]);

	return { state, retry };
}

type ExpenseEntry = Awaited<ReturnType<RetrospendClient["expenses"]["get"]>>;
type SharedEntry = Awaited<
	ReturnType<RetrospendClient["shared-expenses"]["get"]>
>;

/** The saved expense an edit opens: yours alone, or one split with people. */
export type SavedEntry =
	| { kind: "expense"; entry: ExpenseEntry }
	| { kind: "shared"; entry: SharedEntry };

export type EditState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "error" }
	| { status: "ready"; saved: SavedEntry };

/**
 * The saved expense an edit starts from, read fresh: an edit replaces the
 * server's row, so it must begin from the server's current values.
 */
export function useEditEntry(
	id: string | undefined,
	shared = false,
): EditState {
	const { api } = useSession();
	const [state, setState] = useState<EditState>(
		id ? { status: "loading" } : { status: "idle" },
	);
	useEffect(() => {
		if (!id) return;
		if (!api) {
			setState({ status: "error" });
			return;
		}
		let cancelled = false;
		setState({ status: "loading" });
		const read: Promise<SavedEntry> = shared
			? api["shared-expenses"]
					.get({ id })
					.then((entry) => ({ kind: "shared", entry }))
			: api.expenses.get({ id }).then((entry) => ({ kind: "expense", entry }));
		read.then(
			(saved) => !cancelled && setState({ status: "ready", saved }),
			() => !cancelled && setState({ status: "error" }),
		);
		return () => {
			cancelled = true;
		};
	}, [api, id, shared]);
	return state;
}
