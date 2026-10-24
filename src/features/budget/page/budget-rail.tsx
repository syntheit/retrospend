"use client";

import { useTranslations } from "next-intl";
import { Section } from "~/components/layout/section";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import type { BudgetActions } from "./use-budget-actions";

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
							open={{
								label: t("owed.open"),
								onOpen: () => actions.sheet.open("owed", { month }),
							}}
							sub={
								owed.pending.minor !== 0 ? (
									<RowSub
										parts={[
											t.rich("owed.pending", {
												amount: () => <Money value={owed.pending} />,
											}),
										]}
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
									value={toAssign.terms.moneyIn}
								/>
							}
							open={{
								label: t("moneyIn.open"),
								onOpen: () => actions.sheet.open("income", { month }),
							}}
							title={t("moneyIn.thisMonth")}
						/>
					</RowList>
					<p className="text-fg-3 text-meta mt-2">{t("moneyIn.hint")}</p>
				</Section>
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
							open={{
								label: t("shares.open"),
								onOpen: () => actions.sheet.open("splits", { month }),
							}}
							sub={
								<RowSub
									parts={[
										shares.unresolved > 0
											? t("shares.unresolved", { count: shares.unresolved })
											: null,
										shares.pending.minor !== 0 ? t("shares.pending") : null,
									]}
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
