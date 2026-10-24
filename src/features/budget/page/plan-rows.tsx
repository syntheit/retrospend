"use client";

import { useTranslations } from "next-intl";
import { Fragment } from "react";
import { AvailablePill } from "~/components/money/available-pill";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { CategoryTile } from "~/components/ui/category-badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import type { EnvelopeGroupDto, GetMonthOutput } from "~/lib/schemas/envelope";
import type { DraftPreview } from "~/lib/schemas/envelope-plan";
import { useGroupName } from "./group-parts";
import { useTargetParts } from "./target-line";
import { groupKey, toEnvelopeVM } from "./view-model";

type Line = DraftPreview["envelopes"][number];
type Envelope = GetMonthOutput["groups"][number]["envelopes"][number];

type PlanRowsProps = {
	groups: EnvelopeGroupDto[];
	/** The draft's dry run, by envelope: Planned and Left come from it. */
	lines: ReadonlyMap<string, Line>;
	onEdit: (envelopeId: string) => void;
};

/** An envelope's Left in the plan: a pill when the plan leaves it short. */
function PlanLeft({ line }: { line: Line | undefined }) {
	if (!line) return null;
	return line.short ? (
		<AvailablePill amount={line.left.after} status="underfunded" />
	) : (
		<Money className="font-semibold" value={line.left.after} />
	);
}

function PlanName({
	e,
	onEdit,
}: {
	e: Envelope;
	onEdit: (envelopeId: string) => void;
}) {
	const t = useTranslations("budgetPage.plan");
	return (
		<Button
			aria-label={t("edit", { name: e.name })}
			className="text-body text-fg h-auto max-w-full justify-start px-0 font-medium"
			kind="ghost"
			onClick={() => onEdit(e.id)}
		>
			<span className="truncate">{e.name}</span>
		</Button>
	);
}

/** Desktop: Envelope, Planned and Left, by group. */
export function PlanTable({ groups, lines, onEdit }: PlanRowsProps) {
	const t = useTranslations("budgetPage.plan");
	const name = useGroupName();
	const parts = useTargetParts();
	return (
		<Table aria-label={t("table")} look="panel">
			<TableHeader>
				<TableRow>
					<TableHead className="w-1/3">{t("envelope")}</TableHead>
					<TableHead className="text-right">{t("planned")}</TableHead>
					<TableHead className="text-right">{t("left")}</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{groups.map((g) => (
					<Fragment key={groupKey(g)}>
						<TableRow>
							<TableCell className="text-body text-fg font-medium" colSpan={3}>
								{name(g)}
							</TableCell>
						</TableRow>
						{g.envelopes.map((e) => {
							const line = lines.get(e.id);
							return (
								<TableRow data-envelope={e.id} key={e.id}>
									<TableCell className="max-w-0 overflow-hidden">
										<div className="flex items-center gap-3">
											<CategoryTile category={toEnvelopeVM(e).category} />
											<div className="min-w-0 leading-snug">
												<PlanName e={e} onEdit={onEdit} />
												<RowSub parts={parts(e, { needed: false })} />
											</div>
										</div>
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{line ? <Money value={line.assigned.after} /> : null}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										<div className="flex justify-end">
											<PlanLeft line={line} />
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

/** Phone: one Left per row (R29), what is planned in the subline. */
export function PlanList({ groups, lines, onEdit }: PlanRowsProps) {
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
									end={<PlanLeft line={line} />}
									key={e.id}
									lead={<CategoryTile category={toEnvelopeVM(e).category} />}
									open={{
										label: t("edit", { name: e.name }),
										onOpen: () => onEdit(e.id),
									}}
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
