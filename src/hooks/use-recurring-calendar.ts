import {
	eachDayOfInterval,
	endOfMonth,
	endOfWeek,
	getDay,
	isSameDay,
	isSameMonth,
	startOfMonth,
	startOfWeek,
} from "date-fns";
import { useMemo } from "react";
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
				templates?.filter((template) => {
					const dueDate = new Date(template.nextDueDate);

					// Precise check: is it actually due on this literal date?
					if (isSameDay(dueDate, date)) return true;

					// Projection logic (matching current component behavior)
					// This allows the calendar to show recurring events in future/past months
					const frequency = template.frequency;
					if (frequency === "MONTHLY") {
						return dueDate.getDate() === date.getDate();
					}
					if (frequency === "WEEKLY") {
						return getDay(dueDate) === getDay(date);
					}
					if (frequency === "YEARLY") {
						return (
							dueDate.getDate() === date.getDate() &&
							dueDate.getMonth() === date.getMonth()
						);
					}

					return false;
				}) ?? [];

			return {
				date,
				isCurrentMonth: isSameMonth(date, monthStart),
				templates: dayTemplates,
			};
		});
	}, [templates, currentDate]);
}
