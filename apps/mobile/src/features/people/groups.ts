import type { Money } from "@retrospend/domain/money-minor";
import type { PersonSummary } from "./source";

export type PeopleGroup = PersonSummary["group"];
export type PeopleChip = "all" | "owesYou" | "youOwe" | "notOnRetrospend";

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
 * The server's order inside a group stands; the groups come in the order
 * people care about (owed to you first), and an empty group is left out.
 */
export function sectionsOf(
	people: PersonSummary[],
	chip: PeopleChip,
	query: string,
): PeopleSection[] {
	const kept = people.filter(
		(p) => chipKeeps(chip, p) && (query === "" || matchesName(p, query)),
	);
	return ORDER.map((group) => ({
		group,
		people: kept.filter((p) => p.group === group),
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
 * A home-currency net is an estimate when any part is in another currency
 * (it was converted at the reference rates); one currency is exact.
 */
export function isApproximate(
	parts: { amount: Money }[],
	home: string,
): boolean {
	return parts.some((part) => part.amount.currency !== home);
}
