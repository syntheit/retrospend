/**
 * The Projects list's view model: groups and filters the server's rows and
 * picks which of a row's per-currency lines it shows. It never adds,
 * converts or rounds money (R9): every amount is one line the server sent.
 */
import type { MoneyValue } from "~/components/money/format";
import type { RouterOutputs } from "~/trpc/react";

export type ListItem = RouterOutputs["project"]["listView"][number];

/** The line in the project's own currency, else the first one. Null when there is none. */
export function lineIn(
	lines: readonly MoneyValue[],
	currency: string,
): MoneyValue | null {
	return lines.find((l) => l.currency === currency) ?? lines[0] ?? null;
}

/** Search text without case or accents, so "florianopolis" finds "Florianópolis". */
export function fold(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLocaleLowerCase();
}

export type ProjectGroups = {
	active: ListItem[];
	/** Archived projects by the year of their last expense, newest year first. */
	years: { year: number; items: ListItem[] }[];
};

/**
 * Active first, then the past by year. A project has no dates or kind of
 * its own yet (GAPS), so "when" is its status and its expense days.
 */
export function groupProjects(
	items: readonly ListItem[],
	query: string,
): ProjectGroups {
	const q = fold(query.trim());
	const shown = q ? items.filter((p) => fold(p.name).includes(q)) : items;
	const years = new Map<number, ListItem[]>();
	for (const p of shown) {
		if (p.status !== "ARCHIVED") continue;
		years.set(p.year, [...(years.get(p.year) ?? []), p]);
	}
	return {
		active: shown.filter((p) => p.status !== "ARCHIVED"),
		years: [...years.entries()]
			.sort(([a], [b]) => b - a)
			.map(([year, list]) => ({ year, items: list })),
	};
}

/** The figure tag of a project figure for one person (`personId` is "type:id"). */
export const figureFor = (id: string, projectId: string, personId?: string) =>
	personId ? `${id}:${projectId}:${personId}` : `${id}:${projectId}`;
