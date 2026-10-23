"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { RowBar } from "~/components/rows/row";
import { cn } from "~/lib/cn";
import { figureFor, lineIn, type PageView } from "./types";

/**
 * The hero (one hero number): the group total, or what a solo project spent,
 * with the count; beside it your share and the budget line with a thin bar
 * (amber only when over). Other currencies stay separate lines, never
 * converted into the hero.
 */
export function ProjectHero({ view, me }: { view: PageView; me: string }) {
	const t = useTranslations("projectV2.hero");
	const cur = view.primaryCurrency;
	const total = lineIn(view.total, cur) ?? { minor: 0, currency: cur };
	const others = view.total.filter((m) => m.currency !== total.currency);
	const share = lineIn(view.myShare, cur);
	const budget = view.budget;
	return (
		<div className="mb-8 flex flex-wrap items-end justify-between gap-x-12 gap-y-4 max-md:flex-col max-md:items-stretch">
			<div className="min-w-0">
				<div className="text-fg-3 text-small">
					{view.solo ? t("spent") : t("groupTotal")}
				</div>
				<Money
					className="text-hero text-fg block"
					figure={figureFor("project.total", view.id)}
					value={total}
				/>
				<div className="text-fg-3 text-small">
					{t("count", { count: view.expenseCount })}
					{others.map((m) => (
						<span key={m.currency}>
							{" · "}
							<Money value={m} />
						</span>
					))}
				</div>
			</div>
			{share || budget ? (
				<div className="flex w-90 max-w-full flex-col gap-3 max-md:w-full">
					{share && !view.solo ? (
						<div className="text-body flex items-baseline justify-between gap-2">
							<span>{t("yourShare")}</span>
							<Money
								className="font-semibold"
								figure={figureFor("project.member.share", view.id, me)}
								value={share}
							/>
						</div>
					) : null}
					{budget ? (
						<div>
							<div className="text-body flex items-baseline justify-between gap-2">
								<span className={cn(budget.over && "text-attention-text")}>
									{t.rich(budget.over ? "over" : "left", {
										amount: () => (
											<Money
												className="font-semibold"
												sign="never"
												value={budget.left}
											/>
										),
									})}
								</span>
								<span className="text-fg-3 text-small">
									{t.rich("ofBudget", {
										amount: () => <Money value={budget.amount} />,
									})}
								</span>
							</div>
							<RowBar
								basis={budget.used}
								label={t("budgetUsed")}
								over={budget.over}
							/>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
