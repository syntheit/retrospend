import { Platform } from "react-native";

/**
 * Projects and Recurring are their own destinations only on iPad, whose
 * sidebar lists them all. Phones (iPhone and Android, tablets included) have
 * five destinations (Home, Activity, Budget, Wealth, People) and the add
 * control, so Projects is the second segment of the People tab and Recurring
 * opens from Settings.
 */
export const PROJECTS_APART = Platform.OS === "ios" && Platform.isPad;
export const RECURRING_APART = PROJECTS_APART;

/** Where a project opens: its own tab on iPad, inside People elsewhere. */
export function projectRoute(id: string) {
	return PROJECTS_APART
		? ({ pathname: "/projects/[id]", params: { id } } as const)
		: ({ pathname: "/people/project/[id]", params: { id } } as const);
}

/** Where the add control lives: a toolbar plus (iPad) or a floating button above the bar. */
export type AddControl = "toolbar" | "floating";

interface PlatformInfo {
	os: string;
	isPad: boolean;
	/** `Platform.Version`: a string like "26.5" on iOS, an API level on Android. */
	version: string | number;
}

/** The major iOS version; 0 when it is not iOS or the string is not a version. */
export function iosMajor({ os, version }: PlatformInfo): number {
	if (os !== "ios") return 0;
	const major = Number.parseInt(String(version), 10);
	return Number.isNaN(major) ? 0 : major;
}

/**
 * Five tabs fill the iPhone's bar (a sixth goes into More), so the detached
 * plus tab is gone: phones float the add button above the bar, Liquid Glass
 * from iOS 26 (AddButton.ios) and a Material 3 FAB on Android. The iPad keeps
 * the plus in the toolbar.
 */
export function addControlFor(info: PlatformInfo): AddControl {
	return info.os === "ios" && info.isPad ? "toolbar" : "floating";
}

export const ADD_CONTROL = addControlFor({
	os: Platform.OS,
	isPad: Platform.OS === "ios" && Platform.isPad,
	version: Platform.Version,
});

/**
 * Room a scrolling screen leaves under its last row so the floating add button
 * never covers it: the button, its margin and a little air.
 */
export const FLOATING_ADD_INSET = ADD_CONTROL === "floating" ? 80 : 0;
