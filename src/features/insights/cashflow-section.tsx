"use client";

import { useTranslations } from "next-intl";
import { Section } from "~/components/layout/section";
import { Money } from "~/components/money/money";
import { usePercent } from "~/components/rows/percent";
import { Row, RowList, RowSub } from "~/components/rows/row";
import type {
	CashflowDTO,
	InsightsFigure,
} from "~/server/services/insights/types";
import { type PartQuery, PartUnavailable, RankedSkeleton } from "./part-states";

function Figure({ figure }: { figure: InsightsFigure }) {
	return (
		<Money
			className="font-semibold"
			figure={figure.value ? figure.id : undefined}
			missing="noRate"
			value={figure.value}
		/>
	);
}

/**
 * Money in against money out for the range: income, what was saved (with the
 * share of income it is) and the two averages, as label and value rows. It
 * ignores the chips, because income has no category, so the page shows it
 * only when no chip is set.
 */
export function CashflowSection({
	query,
	named,
}: {
	query: PartQuery<CashflowDTO>;
	/** Currencies the lead already names (a fact appears once). */
	named: readonly string[];
}) {
	const t = useTranslations("insights.cashflow");
	const percent = usePercent();
	const data = query.data;
	const unnamed = (data?.missingRates ?? []).filter((c) => !named.includes(c));
	return (
		<Section id="cashflow" title={t("title")}>
			{query.isPending ? (
				<RankedSkeleton rows={2} />
			) : query.isError || !data ? (
				<PartUnavailable onRetry={() => void query.refetch()} />
			) : (
				<div aria-busy={query.isPlaceholderData || undefined}>
					<RowList label={t("title")}>
						<Row end={<Figure figure={data.income} />} title={t("income")} />
						<Row
							end={<Figure figure={data.saved} />}
							sub={
								data.savingsRatePct === null ? undefined : (
									<RowSub
										parts={[
											t("rate", {
												percent: percent(data.savingsRatePct * 100, {
													digits: 0,
												}),
											}),
										]}
									/>
								)
							}
							title={t("saved")}
						/>
						<Row
							end={<Figure figure={data.dailyAverage} />}
							title={t("perDay")}
						/>
						<Row
							end={<Figure figure={data.monthlyAverage} />}
							title={t("perMonth")}
						/>
					</RowList>
					{unnamed.length > 0 && (
						<p className="text-fg-3 text-small mt-3">
							{t("missingRates", { currencies: unnamed.join(", ") })}
						</p>
					)}
				</div>
			)}
		</Section>
	);
}
