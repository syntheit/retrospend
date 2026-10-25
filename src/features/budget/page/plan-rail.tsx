"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Section } from "~/components/layout/section";
import { Money } from "~/components/money/money";
import { Row, RowList } from "~/components/rows/row";
import { api } from "~/trpc/react";

/**
 * Beside the plan (SPEC §6.1 draft rail): what the plan costs a month, what
 * usually comes in, and how long the money lasts at this cost. Every figure
 * is the server's (`planCost`); nothing is worked out here.
 */
export function PlanRail({ month }: { month: number }) {
	const t = useTranslations("budgetPage.planRail");
	const format = useFormatter();
	const cost = api.envelope.planCost.useQuery({ month });
	const data = cost.data;
	if (!data || data.incomplete) return null;
	return (
		<aside aria-label={t("label")} className="min-w-0" data-slot="plan-rail">
			<Section id="rail-plan-cost" title={t("title")}>
				<RowList label={t("title")} variant="flat">
					<Row
						end={
							<Money
								className="font-semibold"
								figure="budget.planCost"
								value={data.cost}
							/>
						}
						title={t("cost")}
					/>
					{data.typicalIncome && (
						<Row
							end={
								<Money
									className="font-semibold"
									figure="budget.typicalIncome"
									value={data.typicalIncome}
								/>
							}
							title={t("typical")}
						/>
					)}
				</RowList>
				{data.runway && (
					<p className="text-fg-3 text-meta mt-2">
						{t("runway", {
							months: format.number(data.runway.tenths / 10, {
								maximumFractionDigits: 1,
							}),
						})}
					</p>
				)}
			</Section>
		</aside>
	);
}
