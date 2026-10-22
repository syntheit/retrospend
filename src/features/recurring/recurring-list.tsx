"use client";

import { useTranslations } from "next-intl";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { RecurringTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { Section } from "~/components/layout/section";
import { useRowDates } from "~/components/rows/dates";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { CategoryTile } from "~/components/ui/category-badge";
import { StatusDot } from "~/components/ui/status-dot";
import { cn } from "~/lib/cn";
import type { RecurringItemDTO } from "~/server/services/recurring-view.service";
import { isDue, type RecurringGroup } from "./groups";
import { categoryOf } from "./item-vm";
import { RecurringMoney } from "./recurring-table";
import { targetOf } from "./use-recurring";

type Props = {
	groups: RecurringGroup[];
	today: string;
	handlersFor: (r: RecurringItemDTO) => ActionHandlers<RecurringTarget>;
	onConfirm: (r: RecurringItemDTO) => void;
	onOpen: (r: RecurringItemDTO) => void;
};

/**
 * Phone: one section per group, the Row anatomy with the due state in
 * words and the auto-pay line (recurring.html phone rows). Confirm, Skip
 * and the rest live in the registry menu and long press (R13); a tap on a
 * due item confirms, otherwise it edits.
 */
export function RecurringList(p: Props) {
	const t = useTranslations("activityRecurring");
	const { short } = useRowDates(p.today);
	const when = (r: RecurringItemDTO) =>
		r.paused ? (
			t("due.paused")
		) : r.state === "overdue" ? (
			<StatusDot
				kind="overdue"
				label={t("due.overdueSince", { date: short(r.next) })}
				size="sm"
			/>
		) : r.state === "due" ? (
			<StatusDot kind="due" label={t("due.today")} size="sm" />
		) : (
			short(r.next)
		);
	return (
		<>
			{p.groups.map((g) => (
				<Section count={g.items.length} key={g.id} title={t(`group.${g.id}`)}>
					<RowList label={t(`group.${g.id}`)} variant="group">
						{g.items.map((r) => {
							const handlers = p.handlersFor(r);
							const target = targetOf(r);
							return (
								<ActionArea
									entity="recurring"
									handlers={handlers}
									key={r.id}
									target={target}
								>
									<Row
										actions={
											<ActionMenu
												entity="recurring"
												handlers={handlers}
												target={target}
											/>
										}
										className={cn(r.paused && "text-fg-3")}
										data-id={r.id}
										end={<RecurringMoney r={r} />}
										lead={<CategoryTile category={categoryOf(r, t("other"))} />}
										open={{
											label: r.title,
											onOpen: () => (isDue(r) ? p.onConfirm(r) : p.onOpen(r)),
										}}
										sub={
											<>
												<RowSub
													parts={[
														when(r),
														r.frequency !== "monthly" &&
															t(`frequency.${r.frequency}`),
													]}
												/>
												<RowSub
													parts={[t(r.autoPay ? "autoPay.on" : "autoPay.off")]}
												/>
											</>
										}
										title={r.title}
									/>
								</ActionArea>
							);
						})}
					</RowList>
				</Section>
			))}
		</>
	);
}
