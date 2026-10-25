"use client";

import { draftFromMinor, parseMoneyInput } from "@retrospend/domain/parse";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useState } from "react";
import { AvailablePill } from "~/components/money/available-pill";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { CategoryTile } from "~/components/ui/category-badge";
import { Input } from "~/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import type {
	EnvelopeGroupDto,
	EnvelopeRowDto,
	Money as MoneyDto,
} from "~/lib/schemas/envelope";
import type { DraftPreview } from "~/lib/schemas/envelope-plan";
import { useGroupName } from "./group-parts";
import { useTargetParts } from "./target-line";
import { groupKey, toEnvelopeVM } from "./view-model";

type Line = DraftPreview["envelopes"][number];

/** An envelope's Left in the plan: a pill when the plan leaves it short. */
function PlanLeft({
	line,
	row,
}: {
	line: Line | undefined;
	row: EnvelopeRowDto;
}) {
	// The dry run lists the envelopes the plan moves; the rest keep their own Left.
	const left = line?.left.after ?? row.left;
	return line?.short ? (
		<AvailablePill amount={left} status="underfunded" />
	) : (
		<Money className="font-semibold" value={left} />
	);
}

/**
 * One envelope's planned amount, typed in place (budget.html Plan column).
 * It saves on Enter and on blur, only when the amount is a valid, changed
 * one; a bad entry keeps its text and says so. The server checks it again.
 */
function PlanInput({
	name,
	currency,
	minor,
	onPlan,
}: {
	name: string;
	currency: string;
	minor: number | undefined;
	onPlan: (minor: number) => unknown;
}) {
	const t = useTranslations("budgetPage.plan");
	const locale = useLocale();
	// Nothing planned yet reads empty, with a 0 hint, not as a typed zero.
	const shown = minor ? draftFromMinor(minor, locale, currency) : "";
	const [text, setText] = useState(shown);
	const [seen, setSeen] = useState(shown);
	// A refetch after a save, or a fill, brings the draft's own amount back.
	if (shown !== seen) {
		setSeen(shown);
		setText(shown);
	}
	const result = parseMoneyInput(text, locale, currency);
	const invalid = !result.ok && result.error !== "empty";
	const commit = () => {
		if (!result.ok || result.minor === (minor ?? 0)) return;
		void onPlan(result.minor);
	};
	return (
		<Input
			aria-invalid={invalid || undefined}
			aria-label={t("input", { name })}
			className="h-ctl-sm w-28 text-right tabular-nums"
			inputMode="decimal"
			onBlur={commit}
			onChange={(e) => setText(e.target.value)}
			placeholder="0"
			onKeyDown={(e) => {
				if (e.key === "Enter") e.currentTarget.blur();
				if (e.key === "Escape") setText(shown);
			}}
			value={text}
		/>
	);
}

/**
 * Desktop (budget.html): this month's spending, the plan you type, and what
 * each envelope starts the month with, by group.
 */
export function PlanTable({
	groups,
	lines,
	planned,
	spent,
	currency,
	monthLabel,
	planLabel,
	onPlan,
}: {
	groups: EnvelopeGroupDto[];
	lines: ReadonlyMap<string, Line>;
	planned: ReadonlyMap<string, number>;
	/** What each envelope spent in the month before, from its own read. */
	spent: ReadonlyMap<string, MoneyDto>;
	currency: string;
	/** The month before, "October". */
	monthLabel: string;
	/** The month being planned, "November". */
	planLabel: string;
	onPlan: (envelopeId: string, minor: number) => unknown;
}) {
	const t = useTranslations("budgetPage.plan");
	const name = useGroupName();
	const parts = useTargetParts();
	return (
		<Table aria-label={t("table")} look="panel">
			<TableHeader>
				<TableRow>
					<TableHead className="w-1/3">{t("envelope")}</TableHead>
					<TableHead className="text-right">
						{t("spentIn", { month: monthLabel })}
					</TableHead>
					<TableHead className="text-right">{t("planned")}</TableHead>
					<TableHead className="text-right">
						{t("startsWith", { month: planLabel })}
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{groups.map((g) => (
					<Fragment key={groupKey(g)}>
						<TableRow>
							<TableCell className="text-body text-fg font-medium" colSpan={4}>
								{name(g)}
							</TableCell>
						</TableRow>
						{g.envelopes.map((e) => {
							const before = spent.get(e.id);
							return (
								<TableRow data-envelope={e.id} key={e.id}>
									<TableCell className="max-w-0 overflow-hidden">
										<div className="flex items-center gap-3">
											<CategoryTile category={toEnvelopeVM(e).category} />
											<div className="min-w-0 leading-snug">
												<span className="text-body text-fg block truncate font-medium">
													{e.name}
												</span>
												<RowSub parts={parts(e, { needed: false })} />
											</div>
										</div>
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{before && (
											<Money figure={`envelope.spent:${e.id}`} value={before} />
										)}
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end">
											<PlanInput
												currency={currency}
												minor={planned.get(e.id)}
												name={e.name}
												onPlan={(minor) => onPlan(e.id, minor)}
											/>
										</div>
									</TableCell>
									<TableCell className="text-right tabular-nums">
										<div className="flex justify-end">
											<PlanLeft line={lines.get(e.id)} row={e} />
										</div>
									</TableCell>
								</TableRow>
							);
						})}
					</Fragment>
				))}
			</TableBody>
		</Table>
	);
}

/** Phone: one Left per row (R29), what is planned in the subline; a row opens the plan sheet. */
export function PlanList({
	groups,
	lines,
	onEdit,
}: {
	groups: EnvelopeGroupDto[];
	lines: ReadonlyMap<string, Line>;
	/** Absent until the plan sheet exists. */
	onEdit: ((envelopeId: string) => void) | undefined;
}) {
	const t = useTranslations("budgetPage.plan");
	const name = useGroupName();
	const parts = useTargetParts();
	return (
		<div className="flex flex-col gap-6">
			{groups.map((g) => (
				<section aria-label={name(g)} key={groupKey(g)}>
					<h3 className="text-section text-fg mb-2">{name(g)}</h3>
					<RowList label={name(g)} variant="group">
						{g.envelopes.map((e) => {
							const line = lines.get(e.id);
							return (
								<Row
									data-envelope={e.id}
									end={<PlanLeft line={line} row={e} />}
									key={e.id}
									lead={<CategoryTile category={toEnvelopeVM(e).category} />}
									open={
										onEdit
											? {
													label: t("edit", { name: e.name }),
													onOpen: () => onEdit(e.id),
												}
											: undefined
									}
									sub={
										<RowSub
											parts={[
												line
													? t.rich("plannedSub", {
															amount: () => (
																<Money value={line.assigned.after} />
															),
														})
													: null,
												...parts(e, { needed: false }),
											]}
										/>
									}
									title={e.name}
								/>
							);
						})}
					</RowList>
				</section>
			))}
		</div>
	);
}
