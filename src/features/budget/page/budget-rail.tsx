"use client";

import { useTranslations } from "next-intl";
import { Section } from "~/components/layout/section";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import { api } from "~/trpc/react";
import type { BudgetActions } from "./use-budget-actions";
import { hasDebt } from "./view-model";

/**
 * Total debt (budget.totalDebt) with the way into the payoff plan, for a
 * book that has a debt but is not Pay off debt (whose hero says it).
 */
function DebtBlock({
	month,
	actions,
}: {
	month: number;
	actions: BudgetActions;
}) {
	const t = useTranslations("budgetPage.debt");
	const plan = api.envelope.payoffProject.useQuery({});
	const p = plan.data;
	if (!p) return null;
	return (
		<Section id="rail-debt" title={t("rail")}>
			<RowList label={t("rail")} variant="flat">
				<Row
					end={
						p.incomplete ? undefined : (
							<Money
								className="font-semibold"
								figure="budget.totalDebt"
								value={p.totalDebt}
							/>
						)
					}
					open={
						actions.can("debt")
							? {
									label: t("open"),
									onOpen: () => actions.sheet.open("debt", { month }),
								}
							: undefined
					}
					title={t("total")}
				/>
			</RowList>
		</Section>
	);
}

/**
 * Beside the table on a wide screen, under the list on a phone (R26): who
 * owes you money the budget holds, what came in, and shares waiting for
 * you. Each line opens its sheet; none repeats a number the page shows
 * elsewhere (a fact appears once).
 */
export function BudgetRail({
	data,
	actions,
	readOnly,
}: {
	data: GetMonthOutput;
	actions: BudgetActions;
	readOnly: boolean;
}) {
	const t = useTranslations("budgetPage.rail");
	const { owed, shares, toAssign } = data;
	const month = data.month.key;
	const showOwed =
		owed.held.minor !== 0 || owed.pending.minor !== 0 || owed.people > 0;
	const showShares = shares.unresolved > 0 || shares.pending.minor !== 0;
	return (
		<aside aria-label={t("label")} className="min-w-0" data-slot="budget-rail">
			{showOwed && (
				<Section id="rail-owed" title={t("owed.title")}>
					<RowList label={t("owed.title")} variant="flat">
						<Row
							end={
								<Money
									approx={data.approximate}
									className="text-positive font-semibold"
									figure="budget.heldForOthers"
									value={owed.held}
								/>
							}
							open={
								actions.can("owed")
									? {
											label: t("owed.open"),
											onOpen: () => actions.sheet.open("owed", { month }),
										}
									: undefined
							}
							sub={
								owed.pending.minor !== 0 ? (
									<RowSub
										parts={[
											t.rich("owed.pending", {
												amount: () => <Money value={owed.pending} />,
											}),
										]}
										wrap
									/>
								) : undefined
							}
							title={t("owed.people", { count: owed.people })}
						/>
					</RowList>
					<p className="text-fg-3 text-meta mt-2">
						{t("owed.hint", { pool: toAssign.poolName })}
					</p>
				</Section>
			)}
			{!readOnly && (
				<Section id="rail-money-in" title={t("moneyIn.title")}>
					<RowList label={t("moneyIn.title")} variant="flat">
						<Row
							end={
								<Money
									className="text-positive font-semibold"
									figure="budget.moneyIn"
									value={toAssign.terms.moneyIn}
								/>
							}
							open={
								actions.can("income")
									? {
											label: t("moneyIn.open"),
											onOpen: () => actions.sheet.open("income", { month }),
										}
									: undefined
							}
							title={t("moneyIn.thisMonth")}
						/>
					</RowList>
					<p className="text-fg-3 text-meta mt-2">{t("moneyIn.hint")}</p>
				</Section>
			)}
			{!readOnly && data.book.style !== "DEBT_PAYOFF" && hasDebt(data) && (
				<DebtBlock actions={actions} month={month} />
			)}
			{showShares && (
				<Section id="rail-shares" title={t("shares.title")}>
					<RowList label={t("shares.title")} variant="flat">
						<Row
							end={
								shares.pending.minor !== 0 ? (
									<Money value={shares.pending} />
								) : undefined
							}
							open={
								actions.can("splits")
									? {
											label: t("shares.open"),
											onOpen: () => actions.sheet.open("splits", { month }),
										}
									: undefined
							}
							sub={
								<RowSub
									parts={[
										shares.unresolved > 0
											? t("shares.unresolved", { count: shares.unresolved })
											: null,
										shares.pending.minor !== 0 ? t("shares.pending") : null,
									]}
									wrap
								/>
							}
							title={t("shares.line")}
						/>
					</RowList>
				</Section>
			)}
		</aside>
	);
}
