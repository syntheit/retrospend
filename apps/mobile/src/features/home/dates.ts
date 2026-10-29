import { useFormatter } from "use-intl";

/** A calendar day the server named ("2026-10-21") as a local date, never shifted by a zone. */
function dayOf(day: string): Date {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	return new Date(y, m - 1, d);
}

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
