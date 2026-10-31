import type { SearchHit, SearchResult } from "@retrospend/api-contract";
import { currenciesHref, recurringHref } from "@/features/account/places";
import { PROJECTS_APART } from "@/layout/destinations";
import type { GlyphName } from "@/ui/Glyph";

/** The kinds of result the search screen shows, in the order it shows them. */
export const SEARCH_GROUPS = ["expenses", "people", "projects"] as const;
export type SearchGroup = (typeof SEARCH_GROUPS)[number];

/** Hits asked for per group; the web palette shows about as many. */
export const HITS_PER_GROUP = 8;
export const RECENT_MAX = 8;
/** A query shorter than this is not sent. */
export const MIN_QUERY = 1;

/** The query as typed, without the spaces the server would trim anyway. */
export function cleanQuery(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}

/** Newest first, no repeats (any case), at most RECENT_MAX. */
export function addRecent(list: readonly string[], query: string): string[] {
	const q = cleanQuery(query);
	if (q === "") return [...list];
	const same = q.toLocaleLowerCase();
	return [
		q,
		...list.filter((item) => item.toLocaleLowerCase() !== same),
	].slice(0, RECENT_MAX);
}

/** Reads a saved list back, dropping anything that is not a short text. */
export function parseRecents(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const value: unknown = JSON.parse(raw);
		if (!Array.isArray(value)) return [];
		const out: string[] = [];
		for (const item of value) {
			if (typeof item !== "string") continue;
			const q = cleanQuery(item);
			if (q !== "" && q.length <= 100) out.push(q);
		}
		return out.slice(0, RECENT_MAX);
	} catch {
		return [];
	}
}

/** The groups of an answer, in screen order, with the empty ones left out. */
export function groupsOf(
	result: SearchResult,
): { type: SearchGroup; items: SearchHit[] }[] {
	return SEARCH_GROUPS.flatMap((type) => {
		const group = result.groups.find((g) => g.type === type);
		return group && group.items.length > 0 ? [{ type, items: group.items }] : [];
	});
}

/** A page the Go to group can open. `label` is a key under mobile.search.places. */
export interface Place {
	id: string;
	glyph: GlyphName;
	label: string;
	href: string;
	/** A tab goes there; the rest push over what is open. */
	tab?: true;
}

/** The pages worth jumping to, as the web palette's Go to group lists them. */
export function places(): Place[] {
	return [
		{ id: "home", glyph: "Home", label: "home", href: "/home", tab: true },
		{
			id: "activity",
			glyph: "ListChecks",
			label: "activity",
			href: "/activity",
			tab: true,
		},
		{
			id: "budget",
			glyph: "Wallet",
			label: "budget",
			href: "/budget",
			tab: true,
		},
		{
			id: "wealth",
			glyph: "Landmark",
			label: "wealth",
			href: "/wealth",
			tab: true,
		},
		{
			id: "people",
			glyph: "Users",
			label: "people",
			href: "/people",
			tab: true,
		},
		{
			id: "projects",
			glyph: "Briefcase",
			label: "projects",
			href: PROJECTS_APART ? "/projects" : "/people",
			tab: true,
		},
		{
			id: "recurring",
			glyph: "Repeat",
			label: "recurring",
			href: recurringHref(),
		},
		{
			id: "insights",
			glyph: "ChartLine",
			label: "insights",
			href: "/home/insights",
		},
		{
			id: "currencies",
			glyph: "Coins",
			label: "currencies",
			href: currenciesHref(),
		},
		{
			id: "notifications",
			glyph: "Bell",
			label: "notifications",
			href: "/settings/notifications",
		},
		{
			id: "settings",
			glyph: "Settings",
			label: "settings",
			href: "/settings",
		},
	];
}

/** Lowercase without accents, so "cafe" finds "Café". */
function fold(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLocaleLowerCase();
}

/** The places whose name contains the text (any case, accents ignored). */
export function matchPlaces(
	all: readonly Place[],
	nameOf: (place: Place) => string,
	query: string,
): Place[] {
	const q = fold(cleanQuery(query));
	if (q === "") return [...all];
	return all.filter((place) => fold(nameOf(place)).includes(q));
}
