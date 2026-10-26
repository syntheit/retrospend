import type { renameBillingPeriodSchema } from "@retrospend/api-contract";
import type * as z from "zod";
import { readFigures } from "~/server/figures/read";
import { sumMinor, toMinor } from "~/server/services/envelope/units";
import type { LedgerCaller } from "./money-op";
import { trpcBillingPeriod } from "./trpc-bridge";

/**
 * v1 adapters for /projects/{id}/billing-periods. The rules (who may close,
 * the auto-close, settle only when every balance is paid) are the web's:
 * the billingPeriod procedures run in-process. The detail adds up per
 * currency, where the web's detail adds raw numbers across currencies. Its
 * total is the registry's `project.total` narrowed to the period, the figure
 * the project page reads; by category and by person are still added up here
 * (no registry figure for them yet, docs/ui/GAPS.md).
 */

type Rename = z.infer<typeof renameBillingPeriodSchema>;

type PeriodRow = {
	id: string;
	label: string;
	startDate: Date;
	endDate: Date;
	status: "OPEN" | "CLOSING" | "SETTLED" | "ARCHIVED";
	closedAt: Date | null;
	settledAt: Date | null;
};

const periodOf = (p: PeriodRow) => ({
	id: p.id,
	label: p.label,
	startDate: p.startDate.toISOString(),
	endDate: p.endDate.toISOString(),
	status: p.status,
	closedAt: p.closedAt?.toISOString() ?? null,
	settledAt: p.settledAt?.toISOString() ?? null,
});

/** Amounts added up per currency, in minor units. */
function totalsOf(rows: { amount: { toString(): string }; currency: string }[]) {
	const byCurrency = new Map<string, number[]>();
	for (const r of rows) {
		const list = byCurrency.get(r.currency) ?? [];
		list.push(toMinor(r.amount.toString(), r.currency));
		byCurrency.set(r.currency, list);
	}
	return [...byCurrency]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([currency, list]) => ({ minor: sumMinor(list), currency }));
}

export async function listBillingPeriods(caller: LedgerCaller, id: string) {
	const rows = await (await trpcBillingPeriod(caller)).list({ projectId: id });
	return {
		items: rows.map((r) => ({
			...periodOf(r),
			expenseCount: r.transactionCount,
			unverifiedCount: r.unverifiedCount,
			shareCount: r.totalParticipantCount,
		})),
	};
}

export async function readBillingPeriod(
	caller: LedgerCaller,
	id: string,
	periodId: string,
) {
	const period = await (await trpcBillingPeriod(caller)).detail({
		projectId: id,
		periodId,
	});
	const expenses = period.sharedTransactions;

	const categories = new Map<
		string,
		{ name: string; color: string; rows: typeof expenses }
	>();
	for (const e of expenses) {
		if (!e.categoryId || !e.category) continue;
		const entry = categories.get(e.categoryId) ?? {
			name: e.category.name,
			color: e.category.color,
			rows: [],
		};
		entry.rows.push(e);
		categories.set(e.categoryId, entry);
	}

	const people = new Map<
		string,
		{
			type: "user" | "guest" | "shadow";
			id: string;
			shares: { amount: string; currency: string }[];
		}
	>();
	for (const e of expenses) {
		for (const sp of e.splitParticipants) {
			const key = `${sp.participantType}:${sp.participantId}`;
			const entry = people.get(key) ?? {
				type: sp.participantType,
				id: sp.participantId,
				shares: [],
			};
			entry.shares.push({
				amount: sp.shareAmount.toString(),
				currency: e.currency,
			});
			people.set(key, entry);
		}
	}

	const read = await readFigures(caller.principal.userId, ["project.total"], {
		projectId: id,
		periodId,
	});
	return {
		...periodOf(period),
		expenseCount: expenses.length,
		total: (read.get("project.total") ?? []).map((m) => ({ ...m })),
		byCategory: [...categories].map(([categoryId, c]) => ({
			categoryId,
			name: c.name,
			color: c.color,
			total: totalsOf(c.rows),
		})),
		byPerson: [...people.values()].map((p) => ({
			person: { type: p.type, id: p.id },
			share: totalsOf(p.shares),
		})),
	};
}

export async function closeBillingPeriod(caller: LedgerCaller, id: string) {
	const { closedPeriod, newPeriod } = await (
		await trpcBillingPeriod(caller)
	).closeCurrent({ projectId: id });
	return { closed: periodOf(closedPeriod), next: periodOf(newPeriod) };
}

export async function settleBillingPeriod(
	caller: LedgerCaller,
	id: string,
	periodId: string,
) {
	return periodOf(
		await (await trpcBillingPeriod(caller)).settlePeriod({
			projectId: id,
			periodId,
		}),
	);
}

export async function renameBillingPeriod(
	caller: LedgerCaller,
	body: Rename,
) {
	return periodOf(
		await (await trpcBillingPeriod(caller)).updateLabel({
			projectId: body.id,
			periodId: body.periodId,
			label: body.label,
		}),
	);
}
