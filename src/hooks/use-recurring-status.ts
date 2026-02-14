import {
	differenceInDays,
	format,
	startOfToday,
	subMonths,
	subWeeks,
	subYears,
} from "date-fns";
import { useMemo } from "react";
import type { RecurringTemplate } from "~/types/recurring";

export function useRecurringStatus(template: RecurringTemplate) {
	return useMemo(() => {
		const nextDate = new Date(template.nextDueDate);
		const today = startOfToday();

		// Calculate the start of the current period based on frequency
		let cycleStart = new Date(nextDate);
		switch (template.frequency) {
			case "WEEKLY":
				cycleStart = subWeeks(cycleStart, 1);
				break;
			case "MONTHLY":
				cycleStart = subMonths(cycleStart, 1);
				break;
			case "YEARLY":
				cycleStart = subYears(cycleStart, 1);
				break;
		}

		const totalDuration = nextDate.getTime() - cycleStart.getTime();
		const now = new Date();
		const elapsed = now.getTime() - cycleStart.getTime();

		const progress =
			totalDuration > 0
				? Math.min(Math.max((elapsed / totalDuration) * 100, 0), 100)
				: 0;

		const daysRemaining = differenceInDays(nextDate, today);

		let status = "";
		let color = "text-muted-foreground";

		if (daysRemaining < 0) {
			status = `Overdue by ${Math.abs(daysRemaining)} days`;
			color = "text-destructive";
		} else if (daysRemaining === 0) {
			status = "Renewing today";
			color = "text-orange-500";
		} else if (daysRemaining < 7) {
			status = `Due in ${daysRemaining} days`;
			color = "text-orange-500";
		} else {
			status = `Renews ${format(nextDate, "MMM d")}`;
			color = "text-muted-foreground";
		}

		return {
			daysRemaining,
			progress,
			status,
			color,
		};
	}, [template]);
}
