"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { MoneyValue } from "~/components/money/format";
import { Money } from "~/components/money/money";
import { usePercent } from "~/components/rows/percent";
import { cn } from "~/lib/cn";

/** A figure's link to the expenses behind it: underline on hover, a visible focus ring. */
export const FIGURE_LINK = cn(
	"rounded-ctl focus-visible:outline-brand can-hover:hover:underline",
	"focus-visible:outline-2 focus-visible:outline-offset-2",
);

/**
 * "Sep 2026 was ARS 2,000,000 (+35%)": the period compared with, its amount
 * and the server's change in whole percent. A period with no spending says so
 * instead of showing a change from nothing.
 */
export function PeriodWas({
	label,
	href,
	value,
	figure,
	changePct,
}: {
	label: string;
	href: string;
	value: MoneyValue;
	figure?: string;
	changePct: number | null;
}) {
	const t = useTranslations("insights.was");
	const percent = usePercent();
	const period = () => (
		<Link className={FIGURE_LINK} href={href}>
			{label}
		</Link>
	);
	if (value.minor === 0) return t.rich("none", { period });
	return t.rich("amount", {
		period,
		amount: () => (
			<Money className="text-fg font-semibold" figure={figure} value={value} />
		),
		change: () =>
			changePct === null ? null : (
				<span className="text-fg-3 text-small">
					({percent(changePct * 100, { signed: true, digits: 0 })})
				</span>
			),
	});
}
