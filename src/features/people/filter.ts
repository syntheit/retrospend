/**
 * The People list's search, chips and sort. Sorting by balance reads the
 * net the server computed (no money math here); people without a net (a
 * currency has no rate) sort after those with one.
 */
import type {
	PeopleFilters,
	PeopleGroup,
	PeopleSort,
	PersonSummary,
} from "./types";

/** How the page names someone in a sentence: "Lucía" for "Lucía Fernández". */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Lowercase without accents, so "lucia" finds Lucía. */
export const fold = (s: string) =>
	s
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();

export function matchesPerson(p: PersonSummary, f: PeopleFilters): boolean {
	if (f.dir && p.group !== f.dir) return false;
	if (f.notOnRetrospend && p.person.onRetrospend) return false;
	if (!f.query) return true;
	const q = fold(f.query.trim());
	return [p.person.name, p.person.username ?? ""].some((s) =>
		fold(s).includes(q),
	);
}

const size = (p: PersonSummary) =>
	p.net === null ? -1 : Math.abs(p.net.minor);
const lastOf = (p: PersonSummary) => p.lastShared?.date ?? "";

export function sortPeople(
	list: readonly PersonSummary[],
	sort: PeopleSort,
	locale: string,
): PersonSummary[] {
	const byName = (a: PersonSummary, b: PersonSummary) =>
		a.person.name.localeCompare(b.person.name, locale);
	const byRecent = (a: PersonSummary, b: PersonSummary) =>
		lastOf(b).localeCompare(lastOf(a)) || byName(a, b);
	const compare =
		sort === "name"
			? byName
			: sort === "recent"
				? byRecent
				: (a: PersonSummary, b: PersonSummary) =>
						size(b) - size(a) || byName(a, b);
	return [...list].sort(compare);
}

export type PeopleGroups = Record<PeopleGroup, PersonSummary[]>;

/** Owe you, You owe and Pending in the chosen order; Settled newest first. */
export function groupPeople(
	list: readonly PersonSummary[],
	sort: PeopleSort,
	locale: string,
): PeopleGroups {
	const sorted = sortPeople(list, sort, locale);
	const pick = (g: PeopleGroup) => sorted.filter((p) => p.group === g);
	return {
		owed: pick("owed"),
		owe: pick("owe"),
		pending: pick("pending"),
		settled: sortPeople(
			list.filter((p) => p.group === "settled"),
			"recent",
			locale,
		),
	};
}
