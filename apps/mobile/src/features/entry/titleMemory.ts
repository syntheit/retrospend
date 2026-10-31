import { predictCategory } from "@retrospend/domain/category-matcher";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import type { EntryCategory } from "./types";

/** The title must rest this long before the history is asked, as on the web. */
const SETTLE_MS = 300;
/** A title is "known" once it has been used this many times. */
const KNOWN_USES = 2;
const MIN_QUERY = 2;
const MIN_KEYWORD = 3;

export interface LastTime {
	minor: number;
	currency: string;
}

type Suggestion = {
	title: string;
	count: number;
	lastCategoryId: string | null;
	lastAmount: LastTime | null;
};

/** The category a title's keywords stand for (the web's matcher), among yours. */
export function categoryFromKeywords(
	title: string,
	categories: Pick<EntryCategory, "id" | "name">[],
): string | null {
	if (title.length < MIN_KEYWORD) return null;
	const guess = predictCategory(
		title.normalize("NFD").replace(/\p{Diacritic}/gu, ""),
	);
	if (!guess) return null;
	return (
		categories.find((c) => c.name.toLowerCase() === guess.toLowerCase())?.id ??
		null
	);
}

/** The category to pick for a title: from your history for it (twice or more), else its keywords. */
export function categoryForTitle(
	title: string,
	known: Pick<Suggestion, "lastCategoryId"> | null,
	categories: Pick<EntryCategory, "id" | "name">[],
): string | null {
	return known?.lastCategoryId ?? categoryFromKeywords(title, categories);
}

/**
 * The web's title memory. A title you have used before picks the category you
 * gave it last (and "Last time ARS 3,500" says what it cost), and a title
 * with a known keyword picks that category, until you pick one yourself.
 * It only runs when adding. The history is the server's
 * (`GET /expenses/title-suggestions`); offline, or when the read fails, it
 * simply says nothing.
 */
export function useTitleMemory({
	title,
	enabled,
	categories,
	picked,
	onPick,
}: {
	title: string;
	/** Adding, not editing. */
	enabled: boolean;
	categories: Pick<EntryCategory, "id" | "name">[];
	/** The person chose a category themselves: the memory stops choosing. */
	picked: boolean;
	onPick: (categoryId: string) => void;
}): LastTime | null {
	const { api } = useSession();
	const text = title.trim();
	const [settled, setSettled] = useState(text);
	const [known, setKnown] = useState<Suggestion | null>(null);
	const pick = useRef(onPick);
	pick.current = onPick;

	useEffect(() => {
		const id = setTimeout(() => setSettled(text), SETTLE_MS);
		return () => clearTimeout(id);
	}, [text]);

	useEffect(() => {
		if (!enabled || !api || settled.length < MIN_QUERY) {
			setKnown(null);
			return;
		}
		let cancelled = false;
		Promise.resolve()
			.then(() => api.expenses.titleSuggestions({ q: settled }))
			.then(({ items }) => {
				if (cancelled) return;
				const match = items.find(
					(s) => s.title.toLowerCase() === settled.toLowerCase(),
				);
				setKnown(match && match.count >= KNOWN_USES ? match : null);
			})
			.catch(() => {
				if (!cancelled) setKnown(null);
			});
		return () => {
			cancelled = true;
		};
	}, [api, enabled, settled]);

	const auto = enabled ? categoryForTitle(settled, known, categories) : null;
	useEffect(() => {
		if (enabled && auto && !picked) pick.current(auto);
	}, [enabled, auto, picked]);

	return known?.lastAmount ?? null;
}
