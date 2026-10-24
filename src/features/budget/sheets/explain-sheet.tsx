"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { usePoolName } from "./pool";
import type { SheetComponentProps } from "./types";
import { useMonth } from "./use-month";

type Amount = { minor: number; currency: string };

function Lines({
	lines,
	total,
	totalLabel,
	totalFigure,
}: {
	lines: {
		key: string;
		label: string;
		hint?: string;
		value: Amount;
		sign?: "never";
	}[];
	total: Amount;
	totalLabel: string;
	totalFigure: string;
}) {
	return (
		<RowList variant="flat">
			{lines.map((l) => (
				<Row
					end={<Money sign={l.sign} value={l.value} />}
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

/**
 * How a number adds up (B2): tap To assign or an envelope's Left and see
 * its parts. Every line is a figure the server already holds for the month;
 * nothing is added up here, and the last line is the number that was tapped.
 */
export function ExplainSheet({
	open,
	onClose,
	month,
	figure,
	envelopeId,
}: SheetComponentProps<"explain">) {
	const t = useTranslations("budgetSheets.explain");
	const m = useMonth(month);
	const pool = usePoolName(m.data);
	const env = envelopeId ? (m.byId.get(envelopeId) ?? null) : null;
	const terms = m.data?.toAssign.terms;
	const title =
		figure === "left" && env
			? t("leftTitle", { name: env.name })
			: t("toAssignTitle", { pool });
	return (
		<Sheet
			cancelLabel={t("done")}
			detent="medium"
			onOpenChange={(o) => !o && onClose()}
			open={open}
			title={title}
		>
			{m.loading || !m.data ? (
				<SkeletonRows count={4} />
			) : figure === "left" && env ? (
				<Lines
					lines={[
						{ key: "carry", label: t("carriedIn"), value: env.carryIn },
						{ key: "assigned", label: t("assigned"), value: env.assigned },
						{ key: "activity", label: t("spent"), value: env.activity },
					]}
					total={env.left}
					totalFigure="envelope.left"
					totalLabel={t("left")}
				/>
			) : terms ? (
				<Lines
					lines={[
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
					]}
					total={m.data.toAssign.amount}
					totalFigure="budget.notPlannedYet"
					totalLabel={pool}
				/>
			) : null}
		</Sheet>
	);
}
