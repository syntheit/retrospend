import { useEffect, useState } from "react";
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
 * Save can wait for the preview of what it is about to send.
 */
export function useEntryPreview(write: PendingWrite | null): PreviewState {
	const { api } = useSession();
	const [kept, setKept] = useState<{ signature: string; state: PreviewState }>({
		signature: "",
		state: { status: "idle" },
	});
	// A new object every render, but the same text while nothing changed.
	const signature = write
		? `${write.entity}:${JSON.stringify(write.body)}`
		: "";

	useEffect(() => {
		if (!api || !write) return;
		let cancelled = false;
		const timer = setTimeout(() => {
			fetchPreview(api, write).then((state) => {
				if (!cancelled) setKept({ signature, state });
			});
		}, PREVIEW_DELAY_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
		// `write` is read through `signature`.
	}, [api, signature]);

	if (!write) return { status: "idle" };
	return kept.signature === signature ? kept.state : { status: "loading" };
}
