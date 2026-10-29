"use client";

import { useTranslations } from "next-intl";
import { useRowDates } from "~/components/rows/dates";
import { Sheet } from "~/components/ui/sheet";
import type { RecurringItemDTO } from "~/server/services/recurring-view.service";

/**
 * The step before a due recurring item is skipped (R30): nothing is logged,
 * only the next due date moves, and it says so. The toast after it undoes it.
 */
export function SkipSheet({
	item,
	today,
	onOpenChange,
	onSkip,
}: {
	item: RecurringItemDTO;
	today: string;
	onOpenChange: (open: boolean) => void;
	onSkip: () => Promise<void>;
}) {
	const t = useTranslations("activityRecurring.skipSheet");
	const { short } = useRowDates(today);
	return (
		<Sheet
			description={t("description", { date: short(item.nextAfter) })}
			detent="medium"
			onOpenChange={onOpenChange}
			onSubmit={onSkip}
			open
			submitLabel={t("submit")}
			title={t("title", { name: item.title })}
		>
			<p className="text-fg-3 text-meta font-medium">{t("changes")}</p>
			<dl className="divide-line text-body divide-y">
				<div
					className="flex items-baseline justify-between gap-3 py-2"
					data-skip="next"
				>
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
