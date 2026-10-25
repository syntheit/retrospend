"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { usePoolName } from "./pool";
import type { SheetProps } from "./types";
import { type EnvelopeInGroup, type MonthData, useMonth } from "./use-month";

type Amount = { minor: number; currency: string };
type Line = { key: string; label: string; hint?: string; value: Amount };
type Parts = {
	title: string;
	lines: Line[];
	total: Amount;
	totalFigure: string;
	totalLabel: string;
};

function Lines({
	lines,
	total,
	totalLabel,
	totalFigure,
}: Omit<Parts, "title">) {
	return (
		<RowList variant="flat">
			{lines.map((l) => (
				<Row
					end={<Money value={l.value} />}
					key={l.key}
					sub={l.hint ? <RowSub parts={[l.hint]} /> : undefined}
					title={l.label}
				/>
			))}
			<Row
				end={<Money figure={totalFigure} value={total} />}
				title={<span className="font-semibold">{totalLabel}</span>}
			/>
		</RowList>
	);
}

/** The parts of the tapped number, each one a figure the server holds for the month. */
function useParts(
	data: MonthData | null,
	figure: string,
	groupId: string | undefined,
	pool: string,
	env: EnvelopeInGroup | null,
): Parts | null {
	const t = useTranslations("budgetSheets.explain");
	if (!data) return null;
	const group = groupId ? data.groups.find((g) => g.id === groupId) : undefined;
	if (group)
		return {
			title: t("groupTitle", { name: group.name ?? t("noGroup") }),
			lines: [
				{ key: "carry", label: t("carriedIn"), value: group.totals.carryIn },
				{ key: "assigned", label: t("assigned"), value: group.totals.assigned },
				{ key: "activity", label: t("spent"), value: group.totals.activity },
			],
			total: group.totals.left,
			totalFigure: "envelope.left",
			totalLabel: t("left"),
		};
	if (figure === "envelope.left" && env)
		return {
			title: t("leftTitle", { name: env.name }),
			lines: [
				{ key: "carry", label: t("carriedIn"), value: env.carryIn },
				{ key: "assigned", label: t("assigned"), value: env.assigned },
				{ key: "activity", label: t("spent"), value: env.activity },
			],
			total: env.left,
			totalFigure: "envelope.left",
			totalLabel: t("left"),
		};
	if (figure === "budget.leftToSpend") {
		const l = data.leftToSpend;
		return {
			title: t("leftToSpendTitle"),
			lines: [
				{ key: "carry", label: t("carriedIn"), value: l.carry },
				{ key: "assigned", label: t("assigned"), value: l.assigned },
				{ key: "spent", label: t("spent"), value: l.spent },
			],
			total: l.left,
			totalFigure: "budget.leftToSpend",
			totalLabel: t("leftToSpend"),
		};
	}
	const terms = data.toAssign.terms;
	return {
		title: t("toAssignTitle", { pool }),
		lines: [
			{ key: "in", label: t("moneyIn"), value: terms.moneyIn },
			{ key: "assigned", label: t("assignedTo"), value: terms.assigned },
			{
				key: "ahead",
				label: t("assignedAhead"),
				hint: t("assignedAheadHint"),
				value: terms.assignedAhead,
			},
			{
				key: "over",
				label: t("overspendTaken"),
				hint: t("overspendHint"),
				value: terms.overspendTaken,
			},
			{ key: "returned", label: t("returned"), value: terms.returned },
			{
				key: "splits",
				label: t("heldForOthers"),
				hint: t("heldHint"),
				value: terms.splitsNet,
			},
		],
		total: data.toAssign.amount,
		totalFigure: "budget.notPlannedYet",
		totalLabel: pool,
	};
}

/**
 * How a number adds up (B2): tap To assign, Left to spend, an envelope's
 * Left or a group's total and see its parts. Every line is a figure the
 * server already holds for the month; nothing is added up here, and the
 * last line is the number that was tapped.
 */
export function ExplainSheet({
	open,
	onClose,
	month,
	figure,
	envelopeId,
	groupId,
}: SheetProps<{ figure: string; envelopeId?: string; groupId?: string }>) {
	const t = useTranslations("budgetSheets.explain");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const env = envelopeId ? (m.byId.get(envelopeId) ?? null) : null;
	const parts = useParts(m.data, figure, groupId, pool, env);
	return (
		<Sheet
			cancelLabel={t("done")}
			detent="medium"
			onOpenChange={(o) => !o && onClose()}
			open={open}
			title={parts?.title ?? t("toAssignTitle", { pool })}
		>
			{m.loading || !parts ? (
				<SkeletonRows count={4} />
			) : (
				<Lines
					lines={parts.lines}
					total={parts.total}
					totalFigure={parts.totalFigure}
					totalLabel={parts.totalLabel}
				/>
			)}
		</Sheet>
	);
}
