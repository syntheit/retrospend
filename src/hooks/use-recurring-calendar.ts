import {
	eachDayOfInterval,
	endOfMonth,
	endOfWeek,
	isSameMonth,
	startOfMonth,
	startOfWeek,
} from "date-fns";
import { useMemo } from "react";
import { isProjectedOnDate } from "~/lib/recurring";
import type { RecurringTemplate } from "~/types/recurring";

export interface CalendarDay {
	date: Date;
	isCurrentMonth: boolean;
	templates: RecurringTemplate[];
}

export function useRecurringCalendar(
	templates: RecurringTemplate[] | undefined,
	currentDate: Date,
) {
	return useMemo(() => {
		const monthStart = startOfMonth(currentDate);
		const monthEnd = endOfMonth(monthStart);
		const calendarStart = startOfWeek(monthStart);
		const calendarEnd = endOfWeek(monthEnd);

		const days = eachDayOfInterval({
			start: calendarStart,
			end: calendarEnd,
		});

		return days.map((date): CalendarDay => {
			const dayTemplates =
				templates?.filter((template) =>
					isProjectedOnDate(template.frequency, template.nextDueDate, date),
				) ?? [];

			return {
				date,
				isCurrentMonth: isSameMonth(date, monthStart),
				templates: dayTemplates,
			};
		});
	}, [templates, currentDate]);
}
