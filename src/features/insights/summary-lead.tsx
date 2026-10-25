"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import type { DateRangeValue } from "~/components/pickers/date-range-model";
import { cn } from "~/lib/cn";
import type { SummaryDTO } from "~/server/services/insights/types";
import { FIGURE_LINK, PeriodWas } from "./period-was";
import { useRangeLabel } from "./range-label";

function Dot() {
	return (
		<span aria-hidden="true" className="text-fg-3 mx-2">
			·
		</span>
	);
}

/**
 * The one number of the page and the sentence under it: what you spent, how
 * many expenses, what the period before was (with Compare on) and which
 * currencies keep spending out for lack of a rate. Each figure opens the
 * expenses behind it in Activity.
 */
export function SummaryLead({
	summary,
	range,
	today,
	names,
	href,
}: {
	summary: SummaryDTO;
	range: DateRangeValue;
	today: string;
	/** The chips' picks by name, joined: "Groceries, Martín". */
	names: string;
	/** Activity's link for this page's filters, optionally over another span. */
	href: (span?: { from: string; to: string }) => string;
}) {
	const t = useTranslations("insights.summary");
	const label = useRangeLabel(today);
	const all = !range.from && !range.to;
	const lead = all
		? names
			? t("leadAllOn", { names })
			: t("leadAll")
		: names
			? t("leadOn", { names, range: label(range) })
			: t("lead", { range: label(range) });
	const { previousTotal, previousRange } = summary;
	return (
		<div className="mb-8">
			<Link className={cn(FIGURE_LINK, "block w-fit")} href={href()}>
				<Money
					className="text-fg text-title block"
					figure={summary.total.value ? summary.total.id : undefined}
					missing="noRate"
					value={summary.total.value}
				/>
			</Link>
			<p className="text-fg-2 text-body mt-1">
				{lead}
				<Dot />
				<Link className={FIGURE_LINK} href={href()}>
					{t("count", { count: summary.count })}
				</Link>
				{previousTotal?.value && previousRange && (
					<>
						<Dot />
						<PeriodWas
							changePct={summary.changePct}
							figure={previousTotal.id}
							href={href(previousRange)}
							label={label(previousRange)}
							value={previousTotal.value}
						/>
					</>
				)}
				{summary.missingRates.length > 0 && (
					<>
						<Dot />
						<Link
							className={cn(FIGURE_LINK, "text-fg-3 text-small")}
							href="/currencies"
						>
							{t("missingRates", {
								currencies: summary.missingRates.join(", "),
							})}
						</Link>
					</>
				)}
			</p>
		</div>
	);
}
