"use client";

import { Receipt, SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { ExpenseTarget } from "~/components/actions/registry";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { TransactionRow } from "~/components/rows/transaction-row";
import type { TransactionVM } from "~/components/rows/types";
import { TransactionTable } from "~/components/table/transaction-table";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { useIsMobile } from "~/hooks/use-mobile";
import { DayGroups } from "./day-groups";
import {
	applyFilters,
	ExpenseFilters,
	type Filters,
	isFiltered,
	NO_FILTERS,
} from "./expense-filters";
import { type PageView, toTransaction } from "./types";
import { useExpenseActions } from "./use-expense-actions";

/** No expenses yet, with Add expense unless the project is archived. */
function NoExpenses({ view }: { view: PageView }) {
	const t = useTranslations("projectV2.expenses");
	const { openNewExpense } = useExpenseModal();
	const add = () =>
		openNewExpense({
			projectId: view.id,
			projectName: view.name,
			projectDefaultCurrency: view.primaryCurrency,
			isSolo: view.solo,
		});
	return (
		<Empty
			action={
				view.status === "ARCHIVED" ? undefined : (
					<Button kind="secondary" onClick={add} size="sm">
						{t("add")}
					</Button>
				)
			}
			hint={view.solo ? t("emptySolo") : t("emptyShared")}
			icon={Receipt}
			title={t("empty")}
		/>
	);
}

/** The ⋯ menu and right-click of a row, from the expense registry (R8). */
function useRowMenus(view: PageView) {
	const handlers = useExpenseActions(view.id);
	const byId = new Map(view.expenses.map((r) => [r.id, r]));
	const targetOf = (tx: TransactionVM): ExpenseTarget => {
		const r = byId.get(tx.id);
		return {
			id: tx.id,
			name: tx.title,
			mine: r?.mine ?? false,
			locked: r?.locked ?? false,
			reviewed: r?.waiting !== "review",
			shared: (tx.people?.length ?? 0) > 1,
		};
	};
	return {
		menu: (tx: TransactionVM) => (
			<ActionMenu entity="expense" handlers={handlers} target={targetOf(tx)} />
		),
		area: (tx: TransactionVM, el: React.ReactElement) => (
			<ActionArea
				entity="expense"
				handlers={handlers}
				key={tx.id}
				target={targetOf(tx)}
			>
				{el}
			</ActionArea>
		),
	};
}

/**
 * Expenses: one toolbar, then the kit table on desktop or day groups on a
 * phone. A row opens the expense; the ⋯ menu comes from the registry.
 */
export function ExpensesPane({ view, me }: { view: PageView; me: string }) {
	const t = useTranslations("projectV2.expenses");
	const phone = useIsMobile();
	const { openSharedExpense } = useExpenseModal();
	const [f, setF] = useState<Filters>(NO_FILTERS);
	const { menu, area } = useRowMenus(view);
	const rows = useMemo(
		() => applyFilters(view.expenses, f),
		[view.expenses, f],
	);
	if (view.expenses.length === 0) return <NoExpenses view={view} />;
	// A table sorts on one currency's minor units only (a comparison, not a sum).
	const oneCurrency =
		new Set(view.expenses.map((r) => r.amount.currency)).size <= 1;
	const txs = rows.map((r) => ({
		...toTransaction(r, me),
		sortKey: oneCurrency ? r.amount.minor : null,
	}));
	const open = (tx: TransactionVM) => openSharedExpense(tx.id);
	const list =
		rows.length === 0 ? (
			<Empty
				action={
					<Button kind="secondary" onClick={() => setF(NO_FILTERS)} size="sm">
						{t("clear")}
					</Button>
				}
				icon={SearchX}
				title={t("noMatch")}
			/>
		) : phone ? (
			<DayGroups
				row={(tx) =>
					area(
						tx,
						<TransactionRow
							actions={menu(tx)}
							hideProject
							onOpen={() => open(tx)}
							today={view.today}
							tx={tx}
						/>,
					)
				}
				rows={txs}
				today={view.today}
			/>
		) : (
			<TransactionTable
				actions={menu}
				hideProject
				onOpen={open}
				rowArea={area}
				rows={txs}
				selectable={false}
				sort={[{ id: "date", desc: true }]}
				today={view.today}
			/>
		);
	return (
		<section aria-label={t("label")}>
			<ExpenseFilters onChange={setF} value={f} view={view} />
			{list}
			<p className="text-fg-3 text-small mt-3">
				{isFiltered(f)
					? t("shownOf", { shown: rows.length, count: view.expenseCount })
					: t("count", { count: view.expenseCount })}
			</p>
		</section>
	);
}
