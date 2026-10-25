"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { MoneyCell } from "~/components/money/money-cell";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { Notice } from "~/components/ui/notice";
import { type Diff, FigureChanges } from "./figure-changes";
import type { DryRun } from "./use-dry-run";
import { hasAmount, type useSetup } from "./use-setup";

type Setup = ReturnType<typeof useSetup>;
type Amount = { minor: number; currency: string };
const NEW_BOOK_FIGURES = [
	"budget.notPlannedYet",
	"budget.leftToSpend",
	"budget.leftInLimits",
	"budget.leftThisWeek",
];
type Plan = { cost: Amount; available: Amount; short: Amount } | null;

/**
 * "Your envelopes" (or "Pick your limits"): the style's proposal from your
 * last months, each one kept or dropped with its amount. When the plan costs
 * more than you start with, a clear stop says so, with the server's own
 * figures; going on needs you to say your pay covers the rest.
 */
export function SetupEnvelopesStep({
	s,
	dry,
	plan,
	covered,
	onCovered,
	poolName,
}: {
	s: Setup;
	dry: DryRun<Diff>;
	plan: Plan;
	covered: boolean;
	onCovered: (v: boolean) => void;
	poolName: string;
}) {
	const t = useTranslations("budgetSheets.setup");
	const p = s.preset;
	if (!p) return null;
	const limits = s.style === "LIMITS";
	const groups = p.groups.map((g) => ({
		g,
		envelopes: p.envelopes.filter((e) => e.groupKey === g.key),
	}));
	return (
		<div className="flex flex-col gap-4">
			<div>
				<h2 className="text-fg text-section">
					{limits ? t("limitsTitle") : t("envelopesTitle")}
				</h2>
				<p className="text-fg-2 text-small">
					{limits ? t("limitsSub") : t("envelopesSub")}
				</p>
			</div>
			{groups.map(({ g, envelopes }) => (
				<section aria-label={s.name(g.nameKey, null)} key={g.key}>
					<h3 className="text-fg text-small mb-1 font-semibold">
						{s.name(g.nameKey, null)}
					</h3>
					<RowList variant="flat">
						{envelopes.map((e) => (
							<Row
								end={
									hasAmount(e.target) ? (
										<MoneyCell
											currency={p.currency}
											label={t("amountFor", {
												name: s.name(e.nameKey, e.name),
											})}
											onChange={(text) => s.setText(e.key, text)}
											value={s.texts[e.key] ?? ""}
										/>
									) : null
								}
								key={e.key}
								lead={
									<Checkbox
										aria-label={t("keep", { name: s.name(e.nameKey, e.name) })}
										checked={e.isDefault || !s.off.has(e.key)}
										disabled={e.isDefault}
										onCheckedChange={() => s.toggle(e.key)}
									/>
								}
								sub={
									e.target && !hasAmount(e.target) ? (
										<RowSub parts={[t("followsRecurring")]} />
									) : undefined
								}
								title={s.name(e.nameKey, e.name)}
							/>
						))}
					</RowList>
				</section>
			))}
			{plan && plan.short.minor > 0 ? (
				<div className="flex flex-col gap-3">
					<Notice tone="attention">
						{t.rich("stop", {
							cost: () => <Money value={plan.cost} />,
							available: () => <Money value={plan.available} />,
						})}
					</Notice>
					<div className="flex items-start gap-3">
						<Checkbox
							checked={covered}
							id="setup-covered"
							onCheckedChange={(v) => onCovered(v === true)}
						/>
						<Label className="text-body text-fg" htmlFor="setup-covered">
							{t.rich("usePay", {
								short: () => <Money value={plan.short} />,
							})}
						</Label>
					</div>
				</div>
			) : null}
			<FigureChanges
				dry={dry}
				// No budget exists yet, so the figures it will have cannot be read
				// before it does: the block says what the server will start with.
				hide={NEW_BOOK_FIGURES}
				own={() =>
					plan
						? [
								{
									key: "start",
									label: t("moneyNow"),
									value: <Money value={plan.available} />,
								},
							]
						: []
				}
				poolName={poolName}
			/>
		</div>
	);
}
