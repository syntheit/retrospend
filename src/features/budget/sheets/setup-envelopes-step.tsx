"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { MoneyCell } from "~/components/money/money-cell";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { Notice } from "~/components/ui/notice";
import { Segmented } from "~/components/ui/segmented";
import type { ChangeLine } from "~/components/ui/sheet-changes";
import { Field } from "~/features/entry/shared-ui";
import type { SetupResult } from "~/lib/schemas/envelope";
import { type Diff, FigureChanges } from "./figure-changes";
import type { DryRun } from "./use-dry-run";
import { useMonthYear } from "./use-month-name";
import {
	EXTRA_DEBT_KEY,
	hasAmount,
	type PayoffStrategy,
	type useSetup,
} from "./use-setup";

type Setup = ReturnType<typeof useSetup>;
const NEW_BOOK_FIGURES = [
	"budget.notPlannedYet",
	"budget.leftToSpend",
	"budget.leftInLimits",
	"budget.leftThisWeek",
];

/** Pay off debt: which debt gets the extra first. */
function PayFirst({
	value,
	onChange,
}: {
	value: PayoffStrategy;
	onChange: (v: PayoffStrategy) => void;
}) {
	const t = useTranslations("budgetSheets.setup");
	const td = useTranslations("budgetSheets.debt");
	return (
		<Field label={t("payFirst")}>
			<Segmented<PayoffStrategy>
				label={t("payFirst")}
				onChange={onChange}
				options={[
					{ value: "AVALANCHE", label: td("avalanche") },
					{ value: "SNOWBALL", label: td("snowball") },
				]}
				value={value}
			/>
			<p className="text-fg-3 text-small">{td(`about.${value}`)}</p>
		</Field>
	);
}

/** The preview's own lines: the money you start with, the next pay, and where a debt plan leads. */
function useOwnLines(result: SetupResult | null) {
	const t = useTranslations("budgetSheets.setup");
	const dates = useDateFormat();
	const monthYear = useMonthYear();
	return (): ChangeLine[] => {
		if (!result) return [];
		const lines: ChangeLine[] = [];
		if (result.plan)
			lines.push({
				key: "start",
				label: t("moneyNow"),
				value: <Money value={result.plan.available} />,
			});
		if (result.nextPay)
			lines.push({
				key: "nextPay",
				label: t("nextPay"),
				value: <span>{dates.medium(result.nextPay)}</span>,
			});
		const debt = result.payoff;
		if (debt && debt.debts > 0) {
			lines.push({
				key: "debtFree",
				label: t("debtFreeBy"),
				value: (
					<span>
						{debt.debtFreeMonth
							? monthYear(debt.debtFreeMonth)
							: debt.diverges
								? t("debtDiverges")
								: t("debtNever")}
					</span>
				),
			});
			if (!debt.diverges)
				lines.push({
					key: "debtInterest",
					label: t("debtInterest"),
					value: <Money value={debt.totalInterest} />,
				});
		}
		return lines;
	};
}

/**
 * "Your envelopes" (or "Pick your limits"): the style's proposal from your
 * last months, each one kept or dropped with its amount. When the plan costs
 * more than you start with, a clear stop says so, with the server's own
 * figures; going on needs you to say your pay covers the rest. Pay off debt
 * adds who is paid first and the extra, saved with the budget.
 */
export function SetupEnvelopesStep({
	s,
	dry,
	result,
	covered,
	onCovered,
	poolName,
}: {
	s: Setup;
	dry: DryRun<Diff>;
	result: SetupResult | null;
	covered: boolean;
	onCovered: (v: boolean) => void;
	poolName: string;
}) {
	const t = useTranslations("budgetSheets.setup");
	const dates = useDateFormat();
	const own = useOwnLines(result);
	const p = s.preset;
	if (!p) return null;
	const plan = result?.plan ?? null;
	const limits = s.style === "LIMITS";
	const debt = s.style === "DEBT_PAYOFF";
	const hasDebts = p.envelopes.some((e) => e.key.startsWith("debt-"));
	// A group with nothing in it (no bills yet) is not a heading over nothing.
	const groups = p.groups
		.map((g) => ({
			g,
			envelopes: p.envelopes.filter((e) => e.groupKey === g.key),
		}))
		.filter((x) => x.envelopes.length > 0);
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
			{debt && !hasDebts ? <Notice tone="info">{t("noDebts")}</Notice> : null}
			{debt ? (
				<PayFirst onChange={s.setPayoffStrategy} value={s.payoffStrategy} />
			) : null}
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
									e.key === EXTRA_DEBT_KEY ? (
										<RowSub parts={[t("extraSub")]} />
									) : e.target && !hasAmount(e.target) ? (
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
						{plan.cost.minor === 0
							? t.rich("stopNone", {
									available: () => <Money value={plan.available} />,
								})
							: t.rich("stop", {
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
							<span>
								{result?.nextPay
									? t.rich("usePayOn", {
											date: dates.medium(result.nextPay),
											short: () => <Money value={plan.short} />,
										})
									: t.rich("usePay", {
											short: () => <Money value={plan.short} />,
										})}
							</span>
						</Label>
					</div>
				</div>
			) : null}
			<FigureChanges
				dry={dry}
				// No budget exists yet, so the figures it will have cannot be read
				// before it does: the block says what the server will start with.
				hide={NEW_BOOK_FIGURES}
				own={own}
				poolName={poolName}
			/>
		</div>
	);
}
