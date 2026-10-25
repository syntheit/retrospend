"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { api } from "~/trpc/react";
import type { SheetProps } from "./types";
import { useMonth } from "./use-month";
import { useMonthName } from "./use-month-name";

/**
 * Money in this month (SPEC §6.1, §12): what came in, what is expected from
 * your recurring income, and what your plan costs against what you usually
 * get. Every figure is the server's; a rate that is missing leaves a line
 * out and says so.
 */
export function IncomeSheet({ open, onClose, month }: SheetProps) {
	const t = useTranslations("budgetSheets.income");
	const { short } = useRowDates();
	const name = useMonthName();
	const m = useMonth(month);
	const cost = api.envelope.planCost.useQuery(
		m.monthKey ? { month: m.monthKey } : {},
		{ enabled: m.monthKey !== null },
	);
	const recurring = api.recurring.listView.useQuery();
	const expected = (recurring.data?.items ?? []).filter(
		(i) => i.direction === "in" && !i.paused,
	);
	const plan = cost.data ?? null;
	return (
		<Sheet
			cancelLabel={t("done")}
			detent="medium"
			onOpenChange={(o) => !o && onClose()}
			open={open}
			title={t("title", { month: m.monthKey ? name(m.monthKey) : "" })}
		>
			{m.loading || !m.data ? (
				<SkeletonRows count={3} />
			) : (
				<div className="flex flex-col gap-4 pb-4">
					<RowList label={t("received")} variant="flat">
						<Row
							end={<Money value={m.data.toAssign.terms.moneyIn} />}
							title={t("moneyIn")}
						/>
					</RowList>
					{expected.length > 0 ? (
						<section aria-label={t("expected")}>
							<h3 className="text-fg text-small mb-1 font-semibold">
								{t("expected")}
							</h3>
							<RowList variant="flat">
								{expected.map((i) => (
									<Row
										end={<Money value={i.amount} />}
										key={i.id}
										sub={
											<RowSub parts={[t("next", { date: short(i.next) })]} />
										}
										title={i.title}
									/>
								))}
							</RowList>
						</section>
					) : null}
					{plan?.typicalIncome ? (
						<p className="text-fg-2 text-small">
							{t.rich("planCost", {
								cost: () => <Money value={plan.cost} />,
								income: () => <Money value={plan.typicalIncome} />,
							})}
						</p>
					) : plan ? (
						<p className="text-fg-3 text-small">
							{t.rich("planCostOnly", {
								cost: () => <Money value={plan.cost} />,
							})}
						</p>
					) : null}
					{plan?.incomplete ? (
						<p className="text-fg-3 text-small">{t("incomplete")}</p>
					) : null}
				</div>
			)}
		</Sheet>
	);
}
