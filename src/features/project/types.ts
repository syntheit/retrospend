import type { MoneyValue } from "~/components/money/format";
import type { TransactionVM } from "~/components/rows/types";
import { categoryTone } from "~/lib/category-tone";
import type { RouterOutputs } from "~/trpc/react";

export type PageView = RouterOutputs["project"]["pageView"];
export type Summary = RouterOutputs["project"]["summary"];
export type Member = PageView["members"][number];
export type ExpenseRow = PageView["expenses"][number];

export type ProjectTab = "expenses" | "summary" | "people";

export const TABS: readonly ProjectTab[] = ["expenses", "summary", "people"];

export function tabOf(raw: string | null, solo: boolean): ProjectTab {
	const tab = TABS.find((t) => t === raw) ?? "expenses";
	return solo && tab === "people" ? "expenses" : tab;
}

/** The line in the project's own currency, else the first one. Null when there is none. */
export function lineIn(
	lines: readonly MoneyValue[],
	currency: string,
): MoneyValue | null {
	return lines.find((l) => l.currency === currency) ?? lines[0] ?? null;
}

/** The figure tag of a project figure (`personId` is "type:id"). */
export const figureFor = (id: string, projectId: string, personId?: string) =>
	personId ? `${id}:${projectId}:${personId}` : `${id}:${projectId}`;

/**
 * One server row as the kit's TransactionRow and TransactionTable take it.
 * Your share is the server's, in the expense's own currency; nothing here
 * adds or converts.
 */
export function toTransaction(row: ExpenseRow, me: string): TransactionVM {
	return {
		id: row.id,
		title: row.title,
		kind: "expense",
		category: row.category
			? {
					name: row.category.name,
					icon: row.category.icon,
					tone: categoryTone(row.category.color),
				}
			: null,
		amount: row.amount,
		share: row.share ?? undefined,
		reviewed: true,
		waiting: row.waiting ?? undefined,
		people: row.people.map((p) => ({ ...p, isSelf: p.id === me })),
		payerId: row.payerId,
		payerName: row.payerName ?? undefined,
		date: row.date,
	};
}
