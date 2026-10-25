"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import { api } from "~/trpc/react";
import { useMonthLabel } from "./month-switch";
import type { BudgetActions } from "./use-budget-actions";

/**
 * Pay off debt (SPEC §4.2, §6.1): the hero is the debt-free month, with the
 * total debt under it and the two ways in, the payoff plan and Pay down a
 * debt. Every figure is the server's projection (`payoffProject`) at today's
 * rates; a debt with no rate is left out and named (R14, never 1). Left to
 * spend stays one quiet line: it is still the month's number.
 */
export function DebtHero({
	data,
	actions,
}: {
	data: GetMonthOutput;
	actions: BudgetActions;
}) {
	const t = useTranslations("budgetPage.debt");
	const label = useMonthLabel();
	const plan = api.envelope.payoffProject.useQuery({});
	const month = data.month.key;
	const p = plan.data;
	if (plan.isPending)
		return (
			<section aria-busy="true" className="mb-6" data-slot="budget-hero">
				<Skeleton className="mb-2 w-32" shape="line" />
				<Skeleton className="h-8 w-56" shape="money" />
			</section>
		);
	if (!p)
		return (
			<section className="mb-6" data-slot="budget-hero">
				<p className="text-fg-2 text-body">{t("unavailable")}</p>
			</section>
		);
	const missing = [...new Set(p.missingRates.map((m) => m.currency))];
	return (
		<section aria-label={t("label")} className="mb-6" data-slot="budget-hero">
			<div className="text-fg-2 text-small">{t("label")}</div>
			<div className="text-hero text-fg mt-0.5 mb-1 block">
				{p.debtFreeMonth ? label(p.debtFreeMonth) : t("never")}
			</div>
			<p className="text-fg-2 text-body max-w-prose">
				{p.incomplete
					? t("incomplete", { currencies: missing.join(", ") })
					: t.rich("sentence", {
							total: () => (
								<Money figure="budget.totalDebt" value={p.totalDebt} />
							),
							count: p.debts.length,
							months: p.months,
						})}
			</p>
			{p.capped && !p.incomplete && (
				<p className="text-fg-2 text-body">{t("capped")}</p>
			)}
			<p className="text-fg-2 text-small mt-1">
				{t.rich("leftToSpend", {
					amount: () => (
						<Money
							figure={data.verdict.lead.figureId}
							sign={data.verdict.lead.amount.minor < 0 ? "never" : "auto"}
							value={data.verdict.lead.amount}
						/>
					),
				})}
			</p>
			<div className="mt-3 flex flex-wrap items-center gap-3">
				{actions.can("debt") && (
					<Button
						kind="secondary"
						onClick={() => actions.sheet.open("debt", { month })}
						size="sm"
					>
						{t("plan")}
					</Button>
				)}
				{actions.can("payDebt") && (
					<Button
						kind="secondary"
						onClick={() => actions.sheet.open("payDebt", { month })}
						size="sm"
					>
						{t("pay")}
					</Button>
				)}
				{actions.can("afford") && (
					<Button
						className="text-accent-strong"
						kind="ghost"
						onClick={() => actions.sheet.open("afford", { month })}
						size="sm"
					>
						{t("afford")}
					</Button>
				)}
			</div>
		</section>
	);
}
