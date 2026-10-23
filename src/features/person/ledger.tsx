"use client";

import { SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { Section } from "~/components/layout/section";
import { Toolbar } from "~/components/layout/toolbar";
import { useRowDates } from "~/components/rows/dates";
import { RowList } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { useIsMobile } from "~/hooks/use-mobile";
import { Empty } from "~/components/ui/empty-state";
import { Input } from "~/components/ui/input";
import type { PersonPage } from "~/features/people/types";
import {
	byMonth,
	type LedgerFilters,
	ledgerItems,
	matchesItem,
	NO_LEDGER_FILTERS,
} from "./ledger-filter";
import { ExpenseRow, PaymentRow } from "./ledger-rows";
import { LedgerMenu } from "./ledger-menu";
import { LedgerTable } from "./ledger-table";

/**
 * Between you: the shared expenses and the payments, by month, with what
 * each expense does between you. Your own unsettled expense opens to edit.
 */
export function Ledger({
	page,
	filters,
	onFilters,
	today,
}: {
	page: PersonPage;
	filters: LedgerFilters;
	onFilters: (f: LedgerFilters) => void;
	today: string;
}) {
	const t = useTranslations("personPage.ledger");
	const { month } = useRowDates();
	const { openSharedExpense } = useExpenseModal();
	const items = useMemo(
		() => ledgerItems(page.rows, page.payments),
		[page.rows, page.payments],
	);
	const shown = useMemo(
		() => items.filter((i) => matchesItem(i, filters)),
		[items, filters],
	);
	const groups = byMonth(shown);
	const phone = useIsMobile();
	const set = (patch: Partial<LedgerFilters>) =>
		onFilters({ ...filters, ...patch });
	const name = page.person.name;
	const heading = (m: string) =>
		m.slice(0, 4) === today.slice(0, 4)
			? month(`${m}-15`)
			: t("monthYear", { month: month(`${m}-15`), year: m.slice(0, 4) });
	const chip = (on: boolean, patch: Partial<LedgerFilters>, label: string) => (
		<FilterChip onClick={() => set(patch)} selected={on}>
			{label}
		</FilterChip>
	);
	return (
		<Section id="between-you" title={t("title")}>
			<Toolbar
				label={t("filters")}
				search={
					<Input
						aria-label={t("search")}
						className="h-ctl w-60 max-md:w-full"
						onChange={(e) => set({ query: e.target.value })}
						placeholder={t("search")}
						type="search"
						value={filters.query}
					/>
				}
			>
				<FilterChips>
					{chip(
						filters.outstanding,
						{ outstanding: !filters.outstanding },
						t("outstanding"),
					)}
					{chip(filters.review, { review: !filters.review }, t("toReview"))}
					{chip(
						filters.payments,
						{ payments: !filters.payments },
						t("payments"),
					)}
					{chip(
						filters.paidBy === "me",
						{ paidBy: filters.paidBy === "me" ? null : "me" },
						t("paidByYou"),
					)}
					{chip(
						filters.paidBy === "them",
						{ paidBy: filters.paidBy === "them" ? null : "them" },
						t("paidBy", { name }),
					)}
					<LedgerMenu filters={filters} items={items} onFilters={onFilters} />
				</FilterChips>
			</Toolbar>
			{groups.length === 0 ? (
				<Empty
					action={
						<Button
							kind="secondary"
							onClick={() => onFilters(NO_LEDGER_FILTERS)}
							size="sm"
						>
							{t("clear")}
						</Button>
					}
					hint={t("noMatchHint")}
					icon={SearchX}
					title={t("noMatch")}
				/>
			) : !phone ? (
				<LedgerTable
					groups={groups}
					heading={heading}
					onOpen={openSharedExpense}
					person={page.person}
				/>
			) : (
				groups.map((g) => (
					<section aria-label={heading(g.month)} className="mb-4" key={g.month}>
						<h3 className="text-fg-2 text-small mb-1 font-semibold">
							{heading(g.month)}
						</h3>
						<RowList label={heading(g.month)}>
							{g.items.map((i) =>
								i.kind === "expense" ? (
									<ExpenseRow
										key={i.row.id}
										onOpen={
											i.row.canEdit
												? () => openSharedExpense(i.row.id)
												: undefined
										}
										row={i.row}
									/>
								) : (
									<PaymentRow
										key={i.payment.id}
										payment={i.payment}
										person={page.person}
									/>
								),
							)}
						</RowList>
					</section>
				))
			)}
			<p className="text-fg-3 text-meta mt-2 text-center">
				{t("footer", {
					expenses: page.rowCount,
					payments: page.payments.length,
				})}
				{page.rows.length < page.rowCount &&
					` · ${t("newest", { count: page.rows.length })}`}
			</p>
		</Section>
	);
}
