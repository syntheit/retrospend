"use client";

import { CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { Button } from "~/components/ui/button";
import { Tip } from "~/components/ui/tooltip";
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import { useVerdictCopy, type VerdictAction } from "./use-verdict-copy";

/** The sheet a verdict button opens (use-budget-actions maps it). */
export type HeroProps = {
	data: GetMonthOutput;
	names: ReadonlyMap<string, string>;
	/** "October" and "November". */
	month: string;
	next: string;
	onAction: (action: VerdictAction) => void;
	onAfford: () => void;
	onExplain: () => void;
	/** The currencies a missing rate leaves out (R14). */
	missing: string[];
};

/**
 * The one hero of the page (R3): one number, one sentence, at most one
 * button and "Can I afford something?". The lead number is a registry
 * figure (`verdict.lead.figureId`), so the figure audit sees it.
 */
export function BudgetHero({
	data,
	names,
	month,
	next,
	onAction,
	onAfford,
	onExplain,
	missing,
}: HeroProps) {
	const t = useTranslations("budgetPage.hero");
	const v = data.verdict;
	const copy = useVerdictCopy({ names, month, next });
	const limits = v.lead.kind === "LEFT_IN_LIMITS";
	const label = copy.label(v, data.book.style === "SAVE_FIRST");
	const incomplete = data.incomplete || v.incomplete;
	const over = v.state === "OVER_BUDGET" || v.state === "OVER_ASSIGNED";
	return (
		<section aria-label={label} className="mb-6" data-slot="budget-hero">
			<div className="text-fg-2 text-small flex items-center gap-1">
				<span>{label}</span>
				<Tip content={t("why")}>
					<Button
						aria-label={t("why")}
						className="size-6 min-w-0 px-0"
						icon
						kind="ghost"
						onClick={onExplain}
						size="sm"
					>
						<CircleHelp aria-hidden="true" className="size-3.5" />
					</Button>
				</Tip>
			</div>
			<Money
				approx={data.approximate && !incomplete}
				className="text-hero text-fg mt-0.5 mb-1 block"
				figure={v.lead.figureId}
				missing="noRate"
				sign={over ? "never" : "auto"}
				value={incomplete ? null : v.lead.amount}
			/>
			<p className="text-fg-2 text-body max-w-prose">
				{incomplete
					? t("incomplete", { currencies: missing.join(", ") })
					: copy.sentence(v)}
			</p>
			<div className="mt-3 flex flex-wrap items-center gap-3">
				{v.action && !incomplete && (
					<Button
						kind="secondary"
						onClick={() => onAction(v.action as VerdictAction)}
						size="sm"
					>
						{copy.actionLabel(v.action, limits)}
					</Button>
				)}
				<Button
					className="text-accent-strong"
					kind="ghost"
					onClick={onAfford}
					size="sm"
				>
					{t("afford")}
				</Button>
			</div>
		</section>
	);
}
