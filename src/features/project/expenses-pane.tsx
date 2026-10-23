"use client";

import { Receipt, SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { ExpenseTarget } from "~/components/actions/registry";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { Toolbar } from "~/components/layout/toolbar";
import { TransactionRow } from "~/components/rows/transaction-row";
import type { TransactionVM } from "~/components/rows/types";
import { TransactionTable } from "~/components/table/transaction-table";
import { Face } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { FilterChip, FilterChips, FilterMenu } from "~/components/ui/chip";
import { Empty } from "~/components/ui/empty-state";
import { Input } from "~/components/ui/input";
import { fold } from "~/features/projects/view-model";
import { useIsMobile } from "~/hooks/use-mobile";
import { DayGroups } from "./day-groups";
import { type PageView, toTransaction } from "./types";
import { useExpenseActions } from "./use-expense-actions";

type Filters = { query: string; review: boolean; paidBy: string | null };
const NONE: Filters = { query: "", review: false, paidBy: null };

/**
 * Expenses: one toolbar (search, To review, the Filter menu with Paid by),
 * then the kit table on desktop or rows on a phone. A row opens the expense;
 * the ⋯ menu comes from the expense registry.
 */
export function ExpensesPane({ view, me }: { view: PageView; me: string }) {
	const t = useTranslations("projectV2.expenses");
	const phone = useIsMobile();
	const { openNewExpense, openSharedExpense } = useExpenseModal();
	const [f, setF] = useState<Filters>(NONE);
	const handlers = useExpenseActions(view.id);
	const rows = useMemo(() => {
		const q = fold(f.query.trim());
		return view.expenses.filter(
			(r) =>
				(!q || fold(`${r.title} ${r.category?.name ?? ""}`).includes(q)) &&
				(!f.review || r.waiting === "review") &&
				(!f.paidBy || r.payerId === f.paidBy),
		);
	}, [view.expenses, f]);
	// A table sorts on one currency's minor units only (a comparison, not a sum).
	const oneCurrency =
		new Set(view.expenses.map((r) => r.amount.currency)).size <= 1;
	const txs = rows.map((r) => ({
		...toTransaction(r, me),
		sortKey: oneCurrency ? r.amount.minor : null,
	}));
	const byId = new Map(view.expenses.map((r) => [r.id, r]));
	const targetOf = (tx: TransactionVM): ExpenseTarget => {
		const r = byId.get(tx.id);
		return {
			id: tx.id,
			name: tx.title,
			mine: r?.mine ?? false,
			locked: r?.locked ?? false,
			reviewed: r?.waiting !== "review",
			shared: tx.people ? tx.people.length > 1 : false,
		};
	};
	const menu = (tx: TransactionVM) => (
		<ActionMenu entity="expense" handlers={handlers} target={targetOf(tx)} />
	);
	const area = (tx: TransactionVM, el: React.ReactElement) => (
		<ActionArea
			entity="expense"
			handlers={handlers}
			key={tx.id}
			target={targetOf(tx)}
		>
			{el}
		</ActionArea>
	);
	const toReview = view.expenses.filter((r) => r.waiting === "review").length;
	const payer = view.members.find((m) => m.id === f.paidBy);

	if (view.expenses.length === 0)
		return (
			<Empty
				action={
					view.status === "ARCHIVED" ? undefined : (
						<Button
							kind="secondary"
							onClick={() =>
								openNewExpense({
									projectId: view.id,
									projectName: view.name,
									projectDefaultCurrency: view.primaryCurrency,
									isSolo: view.solo,
								})
							}
							size="sm"
						>
							{t("add")}
						</Button>
					)
				}
				hint={view.solo ? t("emptySolo") : t("emptyShared")}
				icon={Receipt}
				title={t("empty")}
			/>
		);

	const filtered = f.query !== "" || f.review || f.paidBy !== null;
	return (
		<section aria-label={t("label")}>
			<Toolbar label={t("filters")}>
				<Input
					aria-label={t("search")}
					className="h-ctl w-60 max-md:w-full"
					onChange={(e) => setF({ ...f, query: e.target.value })}
					placeholder={t("search")}
					type="search"
					value={f.query}
				/>
				<FilterChips>
					{toReview > 0 ? (
						<FilterChip
							onClick={() => setF({ ...f, review: !f.review })}
							selected={f.review}
						>
							{t("toReview", { count: toReview })}
						</FilterChip>
					) : null}
					{payer ? (
						<FilterChip
							lead={
								<Face imageUrl={payer.imageUrl} name={payer.name} size="xs" />
							}
							onClick={() => setF({ ...f, paidBy: null })}
							selected
						>
							{payer.isMe ? t("paidByYou") : t("paidBy", { name: payer.name })}
						</FilterChip>
					) : null}
					{view.solo ? null : (
						<FilterMenu
							groups={[
								{
									id: "paidBy",
									label: t("paidByGroup"),
									items: view.members.map((m) => ({
										id: m.id,
										label: m.isMe ? t("you") : m.name,
										lead: (
											<Face imageUrl={m.imageUrl} name={m.name} size="xs" />
										),
										checked: f.paidBy === m.id,
									})),
								},
							]}
							onToggle={(_, id, on) => setF({ ...f, paidBy: on ? id : null })}
						/>
					)}
				</FilterChips>
			</Toolbar>
			{rows.length === 0 ? (
				<Empty
					action={
						<Button kind="secondary" onClick={() => setF(NONE)} size="sm">
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
								onOpen={() => openSharedExpense(tx.id)}
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
					onOpen={(tx) => openSharedExpense(tx.id)}
					rowArea={area}
					rows={txs}
					selectable={false}
					sort={[{ id: "date", desc: true }]}
					today={view.today}
				/>
			)}
			<p className="text-fg-3 text-small mt-3">
				{filtered
					? t("shownOf", { shown: rows.length, count: view.expenseCount })
					: t("count", { count: view.expenseCount })}
			</p>
		</section>
	);
}
