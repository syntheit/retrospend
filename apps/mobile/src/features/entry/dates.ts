// The day a composer saves is a calendar day, "yyyy-MM-dd". The native
// pickers speak in instants, so these helpers move between the two without
// letting a time zone shift the day.

/** Which clock a picker reads: SwiftUI works in local time, Material 3 in UTC. */
export type PickerFrame = "local" | "utc";

function parts(day: string): [number, number, number] {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	return [y, m, d];
}

/**
 * The instant to hand a picker for a day. Local frame: noon that day on the
 * phone's clock, so no offset or daylight change moves it. UTC frame:
 * midnight UTC, which is what the Material 3 date picker counts days from.
 */
export function pickerDate(day: string, frame: PickerFrame): Date {
	const [y, m, d] = parts(day);
	return frame === "utc"
		? new Date(Date.UTC(y, m - 1, d))
		: new Date(y, m - 1, d, 12);
}

/** The day a picker's instant stands for, read on the same clock it was built on. */
export function dayOfPicker(date: Date, frame: PickerFrame): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return frame === "utc"
		? `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
		: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day `delta` days from `day` (negative for earlier). */
export function shiftDay(day: string, delta: number): string {
	const [y, m, d] = parts(day);
	return dayOfPicker(new Date(Date.UTC(y, m - 1, d + delta)), "utc");
}
