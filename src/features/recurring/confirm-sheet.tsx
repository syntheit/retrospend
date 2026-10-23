"use client";

import { useTranslations } from "next-intl";
import { useRowDates } from "~/components/rows/dates";
import { Sheet } from "~/components/ui/sheet";
import type { RecurringItemDTO } from "~/server/services/recurring-view.service";
import { RecurringMoney } from "./recurring-table";

/**
 * The confirm step before a due recurring expense is logged (R30): it names
 * the amount and the date it books, what moves (the next due date) and what
 * does not. The full Confirm sheet (another amount, another day, Skip) waits
 * for the recurring changes in 2E (GAPS).
 */
export function ConfirmSheet({
	item,
	today,
	onOpenChange,
	onConfirm,
}: {
	item: RecurringItemDTO;
	today: string;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => Promise<void>;
}) {
	const t = useTranslations("activityRecurring.confirmSheet");
	const { short } = useRowDates(today);
	const row = "flex items-baseline justify-between gap-3 py-2";
	return (
		<Sheet
			description={t("description", { date: short(item.next) })}
			detent="medium"
			onOpenChange={onOpenChange}
			onSubmit={onConfirm}
			open
			submitLabel={t("submit")}
			title={t("title", { name: item.title })}
		>
			<p className="text-fg-3 text-meta font-medium">{t("changes")}</p>
			<dl className="divide-line text-body divide-y">
				<div className={row} data-confirm="entry">
					<dt className="text-fg-2">
						{t("entry", { date: short(item.next) })}
					</dt>
					<dd className="text-right">
						<RecurringMoney r={item} />
					</dd>
				</div>
				<div className={row} data-confirm="next">
					<dt className="text-fg-2">{t("next")}</dt>
					<dd className="text-fg tabular-nums">
						{t("nextValue", {
							before: short(item.next),
							after: short(item.nextAfter),
						})}
					</dd>
				</div>
			</dl>
			<p className="text-fg-2 text-small mt-3">{t("unchanged")}</p>
		</Sheet>
	);
}
