/**
 * How a list of accounts is ordered, for the web and the phone alike. The
 * sort mode and the custom order are two facts (Spotify's playlist model):
 * Custom follows the ids you placed by dragging, the others sort by a fact of
 * the account, and switching between them never touches the custom order.
 */

export type AccountSortMode = "custom" | "value" | "name" | "type" | "updated";

/** What the order needs to know about an account. */
export type SortFacts = {
	id: string;
	name: string;
	/** The account type; kinds sort in `TYPE_ORDER`, an unknown one last. */
	type: string;
	/**
	 * What it counts for, in minor units of the home currency, as a size (a
	 * debt by what is owed). Null with no rate: it sorts last, never as zero.
	 */
	size: number | null;
	/** ISO date or timestamp of the last change. */
	updated: string;
};

const TYPE_ORDER: Record<string, number> = {
	CASH: 0,
	INVESTMENT: 1,
	CRYPTO: 2,
	REAL_ESTATE: 3,
	VEHICLE: 4,
	LIABILITY_LOAN: 5,
	LIABILITY_CREDIT_CARD: 6,
	LIABILITY_MORTGAGE: 7,
};

/**
 * Orders the accounts of one group. Value: largest first. Name: A to Z. Type:
 * the kinds in the order of the groups, then by name. Updated: newest change
 * first. Custom: the order you set; an account you have not placed yet follows
 * the placed ones, largest first. Ties fall back to the name, so the order is
 * stable between reloads. The list given is never changed.
 */
export function sortAccounts<T>(
	accounts: readonly T[],
	sort: AccountSortMode,
	locale: string,
	custom: readonly string[],
	facts: (account: T) => SortFacts,
): T[] {
	const rank = new Map(custom.map((id, i) => [id, i]));
	const byName = (x: SortFacts, y: SortFacts) =>
		x.name.localeCompare(y.name, locale, { sensitivity: "base" });
	const bySize = (x: SortFacts, y: SortFacts) => {
		if (x.size === y.size) return 0;
		if (x.size === null) return 1;
		if (y.size === null) return -1;
		return y.size - x.size;
	};
	const compare = (x: SortFacts, y: SortFacts): number => {
		switch (sort) {
			case "name":
				return byName(x, y);
			case "type":
				return (
					(TYPE_ORDER[x.type] ?? 99) - (TYPE_ORDER[y.type] ?? 99)
				);
			case "updated":
				return x.updated === y.updated ? 0 : x.updated < y.updated ? 1 : -1;
			case "value":
				return bySize(x, y);
			case "custom": {
				const a = rank.get(x.id);
				const b = rank.get(y.id);
				if (a !== undefined && b !== undefined) return a - b;
				if (a !== undefined) return -1;
				if (b !== undefined) return 1;
				return bySize(x, y);
			}
		}
	};
	return accounts
		.map((account) => ({ account, f: facts(account) }))
		.sort((x, y) => compare(x.f, y.f) || byName(x.f, y.f))
		.map((x) => x.account);
}

/**
 * The custom order after one account moves inside a group. `all` is every
 * account the screen knows, `shown` the ids of the group as listed now. Only
 * the slots the shown accounts hold are refilled, so accounts of other
 * groups, hidden by a filter or closed keep their places.
 */
export function moveInOrder<T>(
	all: readonly T[],
	custom: readonly string[],
	locale: string,
	shown: readonly string[],
	from: number,
	to: number,
	facts: (account: T) => SortFacts,
): string[] {
	const full = sortAccounts(all, "custom", locale, custom, facts).map(
		(a) => facts(a).id,
	);
	const moved = [...shown];
	const [id] = moved.splice(from, 1);
	if (id === undefined) return full;
	moved.splice(to, 0, id);
	const slots = full.flatMap((x, i) => (shown.includes(x) ? [i] : []));
	const next = [...full];
	slots.forEach((slot, i) => {
		next[slot] = moved[i] ?? next[slot] ?? "";
	});
	return next;
}
