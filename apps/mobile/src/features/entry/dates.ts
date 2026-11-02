// The day a composer saves is a calendar day, "yyyy-MM-dd". The native
// pickers speak in instants, so these helpers move between the two without
// letting a time zone shift the day.
import { dayKey, dayParts, utcDayKey } from "@/lib/days";

/** Which clock a picker reads: SwiftUI works in local time, Material 3 in UTC. */
export type PickerFrame = "local" | "utc";

/**
 * The instant to hand a picker for a day. Local frame: noon that day on the
 * phone's clock, so no offset or daylight change moves it. UTC frame:
 * midnight UTC, which is what the Material 3 date picker counts days from.
 */
export function pickerDate(day: string, frame: PickerFrame): Date {
	const [y, m, d] = dayParts(day);
	return frame === "utc"
		? new Date(Date.UTC(y, m - 1, d))
		: new Date(y, m - 1, d, 12);
}

/** The day a picker's instant stands for, read on the same clock it was built on. */
export function dayOfPicker(date: Date, frame: PickerFrame): string {
	return frame === "utc" ? utcDayKey(date) : dayKey(date);
}
