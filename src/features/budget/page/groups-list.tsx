"use client";

import { ChevronDown } from "lucide-react";
import { Fragment } from "react";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import { EnvelopeRow } from "~/components/rows/envelope-row";
import { RowList, RowSub } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/cn";
import { GroupLeft, useGroupName, useGroupSub } from "./group-parts";
import type { GroupsProps } from "./groups-table";
import { useTargetParts } from "./target-line";
import { groupKey, toEnvelopeVM } from "./view-model";

/**
 * The phone list (budget.html 390): each group is a header with its Left
 * and its sentence, then its envelopes as kit rows with the target line and
 * one Left pill (R29). Everything else (Assigned, Spent) is in the
 * envelope's own sheet.
 */
export function GroupsList({
	groups,
	isOpen,
	onToggle,
	actions,
	readOnly,
	filtering,
}: Omit<GroupsProps, "columns">) {
	const name = useGroupName();
	const sub = useGroupSub();
	const parts = useTargetParts();
	return (
		<div className="flex flex-col gap-6">
			{groups.map((g) => {
				const open = filtering || isOpen(g);
				return (
					<section
						aria-label={name(g)}
						data-envelope-group={groupKey(g)}
						key={groupKey(g)}
					>
						<div className="flex items-center gap-3">
							<Button
								aria-expanded={open}
								className="text-section text-fg h-auto min-w-0 flex-1 flex-col items-start gap-0 px-0 py-1"
								kind="ghost"
								onClick={() => onToggle(g)}
							>
								<span className="flex items-center gap-2">
									<span className="truncate">{name(g)}</span>
									<ChevronDown
										aria-hidden="true"
										className={cn(
											"text-fg-3 transition-transform duration-(--t-state)",
											open && "rotate-180",
										)}
									/>
								</span>
								{!open && <RowSub parts={sub(g)} />}
							</Button>
							<GroupLeft group={g} />
						</div>
						{open && (
							<RowList className="mt-2" label={name(g)} variant="group">
								{g.envelopes.map((e) => {
									const target = {
										id: e.id,
										name: e.name,
										over: e.status === "OVERSPENT",
										debt: Boolean(e.target?.liabilityId),
									};
									const row = (
										<EnvelopeRow
											actions={
												readOnly ? undefined : (
													<ActionMenu
														entity="envelope"
														handlers={actions.envelope}
														target={target}
													/>
												)
											}
											data-envelope={e.id}
											envelope={toEnvelopeVM(e)}
											key={e.id}
											plain
											target={parts(e)}
										/>
									);
									return readOnly ? (
										<Fragment key={e.id}>{row}</Fragment>
									) : (
										<ActionArea
											entity="envelope"
											handlers={actions.envelope}
											key={e.id}
											target={target}
										>
											{row}
										</ActionArea>
									);
								})}
							</RowList>
						)}
					</section>
				);
			})}
		</div>
	);
}
