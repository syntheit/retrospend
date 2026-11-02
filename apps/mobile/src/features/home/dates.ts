import { useFormatter } from "use-intl";
import { dayDate as dayOf } from "@/lib/days";

/** Days and months of the server's calendar, said in the phone's language. */
export function useHomeDates() {
	const format = useFormatter();
	return {
		/** "October": the month a day falls in. */
		month: (day: string) => format.dateTime(dayOf(day), { month: "long" }),
		/** "Wednesday, October 21". */
		weekday: (day: string) =>
			format.dateTime(dayOf(day), {
				weekday: "long",
				month: "long",
				day: "numeric",
			}),
		/** "Oct 21". */
		short: (day: string) =>
			format.dateTime(dayOf(day), { month: "short", day: "numeric" }),
	};
}
