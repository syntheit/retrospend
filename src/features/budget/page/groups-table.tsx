"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment } from "react";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import { AvailablePill } from "~/components/money/available-pill";
import { Money } from "~/components/money/money";
import { RowSub } from "~/components/rows/row";
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
import { cn } from "~/lib/cn";
import type { EnvelopeGroupDto, EnvelopeRowDto } from "~/lib/schemas/envelope";
import { GroupLeft, useGroupName, useGroupSub } from "./group-parts";
import { useTargetParts } from "./target-line";
import type { BudgetActions } from "./use-budget-actions";
import { groupKey, toEnvelopeVM } from "./view-model";

export type GroupsProps = {
	groups: EnvelopeGroupDto[];
	/** "limits" names the first column Limit; a closed month reads End of month. */
	columns: "plan" | "limits" | "closed";
	isOpen: (g: EnvelopeGroupDto) => boolean;
	onToggle: (g: EnvelopeGroupDto) => void;
	actions: BudgetActions;
	/** A closed month is read only: no menus. */
	readOnly: boolean;
	/** Search or a chip is on: show every match, folded or not. */
	filtering: boolean;
};

const NUM = "text-right tabular-nums";

function LeftCell({ e }: { e: EnvelopeRowDto }) {
	const t = useTranslations("budgetPage.table");
	const vm = toEnvelopeVM(e);
	if (e.target?.paid && e.status !== "OVERSPENT")
		return <span className="text-fg-2">{t("paid")}</span>;
	if (vm.status === "funded")
		return (
			<Money
				className="font-semibold"
				figure={vm.figure}
				value={vm.available}
			/>
		);
	return (
		<AvailablePill
			amount={vm.available}
			figure={vm.figure}
			status={vm.status}
		/>
	);
}

function EnvelopeTableRow({
	e,
	columns,
	actions,
	readOnly,
}: {
	e: EnvelopeRowDto;
	columns: GroupsProps["columns"];
	actions: BudgetActions;
	readOnly: boolean;
}) {
	const t = useTranslations("budgetPage.table");
	const parts = useTargetParts();
	const vm = toEnvelopeVM(e);
	// Limits: an envelope with no limit holds nothing to run out of (never "Overspent").
	const noLimit = columns === "limits" && !e.target;
	const target = {
		id: e.id,
		name: e.name,
		over: e.status === "OVERSPENT",
		debt: Boolean(e.target?.liabilityId),
		noLimit,
	};
	const row = (
		<TableRow data-envelope={e.id}>
			<TableCell className="max-w-0">
				<div className="flex items-center gap-3 pl-6">
					<CategoryTile category={vm.category} />
					<div className="min-w-0 leading-snug">
						<span className="text-body text-fg block truncate font-medium">
							{e.name}
						</span>
						{columns !== "closed" && (
							<RowSub parts={parts(e, { limits: columns === "limits" })} />
						)}
					</div>
				</div>
			</TableCell>
			<TableCell className={NUM}>
				{noLimit ? (
					!readOnly && actions.envelope.setLimit ? (
						<Button
							kind="ghost"
							onClick={() => actions.envelope.setLimit?.(target)}
							size="sm"
						>
							{t("setLimit")}
						</Button>
					) : (
						<span className="text-fg-3">{t("noLimitCell")}</span>
					)
				) : (
					<Money value={e.assigned} />
				)}
			</TableCell>
			<TableCell className={NUM}>
				<Money figure={`envelope.spent:${e.id}`} value={e.spent} />
			</TableCell>
			<TableCell className={NUM}>
				<div className="flex justify-end">
					{noLimit ? null : <LeftCell e={e} />}
				</div>
			</TableCell>
			<TableCell className="w-14">
				{!readOnly && (
					<ActionMenu
						entity="envelope"
						handlers={actions.envelope}
						target={target}
					/>
				)}
			</TableCell>
		</TableRow>
	);
	if (readOnly) return row;
	return (
		<ActionArea entity="envelope" handlers={actions.envelope} target={target}>
			{row}
		</ActionArea>
	);
}

/**
 * The desktop table (budget.html): groups with their subtotals on one right
 * edge (R27), each folding to one row; inside, the envelopes with their
 * target line and Assigned, Spent and Left. Limits books call the first
 * column Limit; a closed month ends with "End of month".
 */
export function GroupsTable({
	groups,
	columns,
	isOpen,
	onToggle,
	actions,
	readOnly,
	filtering,
}: GroupsProps) {
	const t = useTranslations("budgetPage.table");
	const name = useGroupName();
	const sub = useGroupSub();
	return (
		<Table aria-label={t("label")} look="panel">
			<TableHeader>
				<TableRow>
					<TableHead className="w-1/3">{t("envelope")}</TableHead>
					<TableHead className={NUM}>
						{columns === "limits" ? t("limit") : t("assigned")}
					</TableHead>
					<TableHead className={NUM}>{t("spent")}</TableHead>
					<TableHead className={NUM}>
						{columns === "closed" ? t("endOfMonth") : t("left")}
					</TableHead>
					<TableHead className="w-14">
						<span className="sr-only">{t("actions")}</span>
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{groups.map((g) => {
					const open = filtering || isOpen(g);
					return (
						<Fragment key={groupKey(g)}>
							<TableRow data-envelope-group={groupKey(g)}>
								<TableCell className="max-w-0">
									<Button
										aria-expanded={open}
										className="text-body text-fg h-auto max-w-full justify-start gap-2 px-0 font-medium"
										kind="ghost"
										onClick={() => onToggle(g)}
									>
										<span className="truncate">{name(g)}</span>
										<ChevronDown
											aria-hidden="true"
											className={cn(
												"text-fg-3 transition-transform duration-(--t-state)",
												open && "rotate-180",
											)}
										/>
									</Button>
									{!open && <RowSub parts={sub(g)} wrap />}
								</TableCell>
								<TableCell className={NUM}>
									<Money value={g.totals.assigned} />
								</TableCell>
								<TableCell className={NUM}>
									<Money value={g.totals.spent} />
								</TableCell>
								<TableCell className={NUM}>
									<div className="flex justify-end">
										<GroupLeft group={g} />
									</div>
								</TableCell>
								<TableCell className="w-14" />
							</TableRow>
							{open &&
								g.envelopes.map((e) => (
									<EnvelopeTableRow
										actions={actions}
										columns={columns}
										e={e}
										key={e.id}
										readOnly={readOnly}
									/>
								))}
						</Fragment>
					);
				})}
			</TableBody>
		</Table>
	);
}
