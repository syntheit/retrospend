"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Money } from "~/components/money/money";
import { Segmented } from "~/components/ui/segmented";
import type { RecurringCost } from "~/server/services/recurring-view.service";

type Period = "month" | "quarter" | "year";

/** The figure ids the summary renders, per direction and period. */
export const costFigure = (dir: "out" | "in", period: Period) =>
	`recurring.cost.${dir}.${period}`;

/**
 * One summary line with a Monthly / Quarterly / Yearly switch (replaces
 * the stat cards and the projections sidebar). Every number is the
 * server's per period; a currency without a rate is named and left out,
 * never counted as zero (B16).
 */
export function RecurringSummary({
	out,
	income,
}: {
	out: RecurringCost;
	income: RecurringCost | null;
}) {
	const t = useTranslations("activityRecurring.summary");
	const [period, setPeriod] = useState<Period>("month");
	const amount = (cost: RecurringCost, dir: "out" | "in") => (
		<Money
			className="text-fg font-semibold"
			figure={costFigure(dir, period)}
			value={cost[period]}
		/>
	);
	return (
		<div className="mb-4 flex flex-wrap items-center gap-3">
			<p className="text-body text-fg-2 flex-1" data-summary>
				{t.rich("cost", {
					amount: () => amount(out, "out"),
					period: t(`per.${period}`),
				})}
				{out.missingRate.length > 0 && (
					<>
						{" "}
						{t("missing", { currencies: out.missingRate.join(", ") })}{" "}
						<Link
							className="text-accent-strong can-hover:hover:underline font-medium"
							href="/currencies"
						>
							{t("setRate")}
						</Link>
					</>
				)}
				{income && (
					<> {t.rich("income", { amount: () => amount(income, "in") })}</>
				)}
			</p>
			<Segmented
				label={t("period")}
				onChange={setPeriod}
				options={[
					{ value: "month", label: t("monthly") },
					{ value: "quarter", label: t("quarterly") },
					{ value: "year", label: t("yearly") },
				]}
				value={period}
			/>
		</div>
	);
}
