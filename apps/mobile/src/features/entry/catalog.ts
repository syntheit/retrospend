import type { RetrospendClient } from "@retrospend/api-client";
import type { ReadCache } from "@/data/cache";
import type { EntryCatalog, EntryPerson } from "./types";

// Categories, people and currencies for the composers. Cached first so the
// composer opens offline, then refreshed from API v1 (same pattern as
// Activity). A failed refresh keeps the cache.

// The response types come from the typed client, so the app needs no zod.
type CategoryDto = Awaited<
	ReturnType<RetrospendClient["categories"]["list"]>
>["items"][number];
type Currency = Awaited<
	ReturnType<RetrospendClient["currencies"]["list"]>
>["items"][number];
type RecentEntries = Awaited<
	ReturnType<RetrospendClient["expenses"]["list"]>
>["items"];
type PeopleOverview = Awaited<ReturnType<RetrospendClient["people"]["list"]>>;

export const ENTRY_CATALOG_CACHE = {
	name: "entry-catalog",
	schema: 2,
} as const;

const PAGE = 200;
/** How many of the latest entries the recent currencies are read from. */
const RECENT_ENTRIES = 40;
const RECENT_CURRENCIES = 5;
const MAX_CURRENCY_PAGES = 5;

export function catalogFrom(input: {
	categories: CategoryDto[];
	overview: PeopleOverview;
	currencies: Currency[];
	recent: RecentEntries;
	home: string;
	fallback: string;
	hasBudget: boolean | null;
}): EntryCatalog {
	const {
		categories,
		overview,
		currencies,
		recent,
		home,
		fallback,
		hasBudget,
	} = input;
	const priced = currencies
		.filter((c) => c.rateTypes.length > 0)
		.map((c) => c.code);
	const people: EntryPerson[] = overview.people
		.slice()
		.sort((a, b) =>
			(b.lastShared?.date ?? "").localeCompare(a.lastShared?.date ?? ""),
		)
		.map(({ person }) => ({
			type: person.type,
			id: person.id,
			name: person.name,
			imageUrl: person.imageUrl,
		}));
	return {
		categories: categories.map((c) => ({
			id: c.id,
			name: c.name,
			icon: c.icon,
			tone: c.tone,
			uses: c.expenseCount,
		})),
		people,
		// The home currency first, then the default one, then the rest by code.
		currencies: [...new Set([home, fallback, ...priced.sort()])],
		recentCurrencies: [
			...new Set(recent.map((entry) => entry.amount.currency)),
		].slice(0, RECENT_CURRENCIES),
		hasBudget,
	};
}

async function currencyPages(api: RetrospendClient): Promise<Currency[]> {
	const out: Currency[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < MAX_CURRENCY_PAGES; page++) {
		const next = await api.currencies.list({ limit: PAGE, cursor });
		out.push(...next.items);
		if (!next.nextCursor) break;
		cursor = next.nextCursor;
	}
	return out;
}

export async function fetchEntryCatalog(
	api: RetrospendClient,
	me: { homeCurrency: string; defaultCurrency: string },
): Promise<EntryCatalog> {
	const [categories, overview, currencies, recent, verdict] = await Promise.all(
		[
			api.categories.list({ limit: PAGE }),
			api.people.list(),
			currencyPages(api),
			// A failed read only leaves the Recent group out.
			api.expenses.list({ limit: RECENT_ENTRIES }).then(
				(page) => page.items,
				() => [],
			),
			// Null means no envelope budget yet. A server without the budget routes
			// leaves it unknown, and Use my plan stays off the screen.
			api.budget.verdict({}).then(
				(v) => v !== null,
				() => null,
			),
		],
	);
	return catalogFrom({
		categories: categories.items,
		overview,
		currencies,
		recent,
		home: me.homeCurrency,
		fallback: me.defaultCurrency,
		hasBudget: verdict,
	});
}

export type CatalogState =
	| { status: "loading" }
	| { status: "ready"; catalog: EntryCatalog; stale: boolean }
	| { status: "error" };

/** Cached catalog first (`onCached`), then the server. */
export async function loadEntryCatalog(
	api: RetrospendClient,
	cache: ReadCache,
	me: { homeCurrency: string; defaultCurrency: string },
	onCached: (state: CatalogState) => void,
): Promise<CatalogState> {
	const cached = await cache.read<EntryCatalog>(
		ENTRY_CATALOG_CACHE.name,
		ENTRY_CATALOG_CACHE.schema,
	);
	if (cached) {
		onCached({ status: "ready", catalog: cached.data, stale: true });
	}
	try {
		const catalog = await fetchEntryCatalog(api, me);
		await cache.write(
			ENTRY_CATALOG_CACHE.name,
			ENTRY_CATALOG_CACHE.schema,
			catalog,
		);
		return { status: "ready", catalog, stale: false };
	} catch {
		return cached
			? { status: "ready", catalog: cached.data, stale: true }
			: { status: "error" };
	}
}

/** The categories to show as chips: the most used, and the picked one. */
export function recentCategories(
	catalog: EntryCatalog,
	count: number,
	picked: string | null,
) {
	const top = catalog.categories
		.slice()
		.sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name))
		.slice(0, count);
	const pickedCategory = picked
		? catalog.categories.find((c) => c.id === picked)
		: undefined;
	// A picked category outside the recents takes the first slot, so nothing
	// moves while someone taps.
	return pickedCategory && !top.some((c) => c.id === pickedCategory.id)
		? [pickedCategory, ...top.slice(0, count - 1)]
		: top;
}
