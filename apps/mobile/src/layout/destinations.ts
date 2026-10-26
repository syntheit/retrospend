import { Platform } from "react-native";

/**
 * Projects is its own destination only on iPad, whose sidebar lists all six.
 * Phones (iPhone and Android, tablets included) have four destinations and
 * the add control, so Projects is the second segment of the People tab.
 */
export const PROJECTS_APART = Platform.OS === "ios" && Platform.isPad;

/** Where a project opens: its own tab on iPad, inside People elsewhere. */
export function projectRoute(id: string) {
	return PROJECTS_APART
		? ({ pathname: "/projects/[id]", params: { id } } as const)
		: ({ pathname: "/people/project/[id]", params: { id } } as const);
}

/** Where the add control lives: the tab bar's own plus, a toolbar plus, or a floating button. */
export type AddControl = "tab" | "toolbar" | "floating";

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
 * The iPhone's detached plus is a UISearchTab, which iOS 26 detaches at the end
 * of the bar. Below iOS 26 the same tab is a plain (disabled) one, so there the
 * phone shows the floating button, like Android. The iPad keeps its toolbar plus.
 */
export function addControlFor(info: PlatformInfo): AddControl {
	if (info.os === "ios" && info.isPad) return "toolbar";
	if (info.os === "ios" && iosMajor(info) >= 26) return "tab";
	return "floating";
}

export const ADD_CONTROL = addControlFor({
	os: Platform.OS,
	isPad: Platform.OS === "ios" && Platform.isPad,
	version: Platform.Version,
});
