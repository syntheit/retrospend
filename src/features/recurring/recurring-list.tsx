"use client";

import { useTranslations } from "next-intl";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { RecurringTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { Section } from "~/components/layout/section";
import { RecurringRow } from "~/components/rows/recurring-row";
import { RowList } from "~/components/rows/row";
import type { RecurringItemDTO } from "~/server/services/recurring-view.service";
import type { RecurringGroup } from "./groups";
import { toRecurringVM } from "./item-vm";
import { canConfirm, targetOf } from "./use-recurring";

type Props = {
	groups: RecurringGroup[];
	today: string;
	handlersFor: (r: RecurringItemDTO) => ActionHandlers<RecurringTarget>;
	/** Opens the confirm step. */
	onConfirm: (r: RecurringItemDTO) => void;
	onOpen: (r: RecurringItemDTO) => void;
};

/**
 * Phone: one section per group of the kit's RecurringRow, with the due
 * state in words and the auto-pay line (recurring.html phone rows).
 * Confirm, Skip and the rest live in the registry menu and long press
 * (R13); a tap on a due item opens the confirm step (amount and date
 * first, R30), otherwise it edits.
 */
export function RecurringList(p: Props) {
	const t = useTranslations("activityRecurring");
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
									<RecurringRow
										actions={
											<ActionMenu
												entity="recurring"
												handlers={handlers}
												target={target}
											/>
										}
										data-id={r.id}
										item={toRecurringVM(r, t("other"))}
										onOpen={() =>
											canConfirm(r) ? p.onConfirm(r) : p.onOpen(r)
										}
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
