// What the composers need to know about the person's data, as small plain
// objects (cached on the phone, so the composer opens offline).

export type PersonType = "user" | "guest" | "shadow";

export interface EntryPerson {
	type: PersonType;
	id: string;
	name: string;
	imageUrl: string | null;
}

export interface EntryCategory {
	id: string;
	name: string;
	/** Its icon key (a lucide name); null means the name's usual glyph. */
	icon: string | null;
	/** The category-n color slot, 1 to 21. */
	tone: number;
	/** Expenses filed under it: the most used come first as recents. */
	uses: number;
}

export interface EntryCatalog {
	categories: EntryCategory[];
	/** People you share with, the latest shared first. */
	people: EntryPerson[];
	/** Currencies the server holds a rate for, plus the home and default ones. */
	currencies: string[];
	/** Currencies of the latest entries, newest first, each once. */
	recentCurrencies: string[];
	/** Whether Use my plan has an envelope budget to fill; null when unknown. */
	hasBudget: boolean | null;
}

/** The person key the split rows and chips share: "user:abc". */
export function personKey(person: { type: PersonType; id: string }): string {
	return `${person.type}:${person.id}`;
}
