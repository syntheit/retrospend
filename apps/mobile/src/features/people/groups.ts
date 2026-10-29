import type { Money } from "@retrospend/domain/money-minor";
import type { PeopleOverview, PersonSummary } from "./source";

export type PeopleGroup = PersonSummary["group"];
export type PeopleChip = "all" | "owesYou" | "youOwe" | "notOnRetrospend";
export type PeopleSort = "balance" | "recent" | "name";

const ORDER: PeopleGroup[] = ["owed", "owe", "pending", "settled"];

export interface PeopleSection {
	group: PeopleGroup;
	people: PersonSummary[];
}

/** Which people a chip keeps. */
export function chipKeeps(chip: PeopleChip, person: PersonSummary): boolean {
	switch (chip) {
		case "all":
			return true;
		case "owesYou":
			return person.group === "owed";
		case "youOwe":
			return person.group === "owe";
		case "notOnRetrospend":
			return !person.person.onRetrospend;
	}
}

/** Name search, ignoring case and accents, as the web's search does. */
export function matchesName(person: PersonSummary, query: string): boolean {
	const fold = (text: string) =>
		text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
	return fold(person.person.name).includes(fold(query));
}

/**
 * Balance is the server's order and stands as it is; Recent puts the last
 * shared expense first (people with none go last); Name is A to Z.
 */
export function sortPeople(
	people: PersonSummary[],
	sort: PeopleSort,
): PersonSummary[] {
	if (sort === "balance") return people;
	if (sort === "name") {
		return [...people].sort((a, b) =>
			a.person.name.localeCompare(b.person.name),
		);
	}
	const day = (p: PersonSummary) => p.lastShared?.date ?? "";
	return [...people].sort((a, b) => day(b).localeCompare(day(a)));
}

/**
 * The groups come in the order people care about (owed to you first), an
 * empty group is left out, and the sort orders the people inside each.
 */
export function sectionsOf(
	people: PersonSummary[],
	chip: PeopleChip,
	query: string,
	sort: PeopleSort = "balance",
): PeopleSection[] {
	const kept = people.filter(
		(p) => chipKeeps(chip, p) && (query === "" || matchesName(p, query)),
	);
	return ORDER.map((group) => ({
		group,
		people: sortPeople(
			kept.filter((p) => p.group === group),
			sort,
		),
	})).filter((section) => section.people.length > 0);
}

/**
 * Which way a person's balance points. The home net decides; with no net (a
 * currency has no rate) the first part with money in it does.
 */
export function sideOf(
	net: Money | null,
	parts: { amount: Money }[],
): "owesYou" | "youOwe" | "settled" {
	const minor =
		net?.minor || parts.find((p) => p.amount.minor !== 0)?.amount.minor;
	if (!minor) return "settled";
	return minor > 0 ? "owesYou" : "youOwe";
}

/**
 * Which of the two totals is an estimate: Owed to you counts the parts that
 * are owed to you, You owe the parts that you owe, each at reference rates
 * when it is in another currency. One currency is exact.
 */
export function approxSides(
	people: PersonSummary[],
	home: string,
): { owedToYou: boolean; youOwe: boolean } {
	const parts = people.flatMap((p) => p.parts);
	return {
		owedToYou: isApproximate(
			parts.filter((p) => p.amount.minor > 0),
			home,
		),
		youOwe: isApproximate(
			parts.filter((p) => p.amount.minor < 0),
			home,
		),
	};
}

/**
 * A home-currency net is an estimate when any part is in another currency
 * (it was converted at the reference rates); one currency is exact.
 */
export function isApproximate(
	parts: { amount: Money }[],
	home: string,
): boolean {
	return parts.some((part) => part.amount.currency !== home);
}

export type Segment = PeopleOverview["segments"][number];

/**
 * Whose face goes over the bar: the biggest owed segments (three on a phone,
 * those of 11% or more), then the biggest you owe. The web bar's rule.
 */
export function pinsOf(segments: Segment[]): Segment[] {
	const owed = segments
		.filter((s) => s.direction === "owed" && s.share >= 1100)
		.slice(0, 3);
	const owe = segments.find((s) => s.direction === "owe");
	return owe ? [...owed, owe] : owed;
}
