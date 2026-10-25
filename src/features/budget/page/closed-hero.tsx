"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { api } from "~/trpc/react";
import { useMonthLabel } from "./month-switch";

/**
 * A closed month (SPEC §6.6): read only, so the top is what the month did,
 * from its stored summary, not a Left to spend. Money in is the one hero;
 * what was assigned and what went over follow in one line. The summary
 * sheet has the rest.
 */
export function ClosedHero({
	month,
	onOpenSummary,
}: {
	month: number;
	onOpenSummary: () => void;
}) {
	const t = useTranslations("budgetPage.closed");
	const label = useMonthLabel();
	const summary = api.envelope.monthSummary.useQuery({ month });
	const s = summary.data?.summary;
	const money = (minor: number) => ({ minor, currency: s?.currency ?? "" });
	return (
		<section
			aria-label={t("label", { month: label(month) })}
			className="mb-6"
			data-slot="budget-hero"
		>
			<div className="text-fg-2 text-small">
				{t("label", { month: label(month) })}
			</div>
			{summary.isPending ? (
				<Skeleton className="my-2 h-8 w-56" shape="money" />
			) : s ? (
				<>
					<div className="text-fg-2 text-small mt-0.5">{t("cameIn")}</div>
					<Money
						className="text-hero text-fg mb-1 block"
						value={money(s.moneyIn)}
					/>
					<p className="text-fg-2 text-body">
						{t.rich("line", {
							assigned: () => <Money value={money(s.assigned)} />,
							over: () => <Money value={money(s.overspent)} />,
							hasOver: s.overspent > 0 ? "yes" : "no",
						})}
					</p>
				</>
			) : (
				<p className="text-fg-2 text-body mt-1">{t("none")}</p>
			)}
			<div className="mt-3">
				<Button kind="secondary" onClick={onOpenSummary} size="sm">
					{t("open")}
				</Button>
			</div>
		</section>
	);
}
