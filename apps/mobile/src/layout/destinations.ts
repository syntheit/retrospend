import { Platform } from "react-native";
import type { MenuItem, TopBarAction } from "@/ui/types";
import { TabSidebar } from "../../modules/tab-sidebar";

/**
 * The iPad follows Apple's tab bar that adapts into a sidebar (HIG, Tab bars
 * and Sidebars; iPadOS 18 and later). The floating tab bar holds the same five
 * destinations as the iPhone (Home, Activity, Budget, Wealth, People), so it
 * does not scroll. The sidebar lists six destinations (those five and
 * Projects) and Settings; Projects and Settings are sidebar only
 * (modules/tab-sidebar). UIKit shows a sidebar-only destination in the bar
 * while it is open, as Apple's own apps do. It opens by default in landscape
 * only.
 *
 * That needs iPadOS 26.1 or later (the UITab path in react-native-screens).
 * Older iPads, phones and Android tablets have the five tabs and the add
 * control: Projects is the second segment of People. On every device
 * Recurring is a segment of Activity and Currencies opens from Settings, and
 * Insights opens from Home.
 */
export const IPAD_SIDEBAR =
	Platform.OS === "ios" &&
	Platform.isPad &&
	(TabSidebar?.isSupported() ?? false);

export const PROJECTS_APART = IPAD_SIDEBAR;
export const RECURRING_APART = false;
export const CURRENCIES_APART = false;

/**
 * Sidebar-only destinations, by route name under app/(tabs), in sidebar
 * order. "preferences" is Settings (app/settings is the stack phones push).
 */
export const SIDEBAR_ONLY = ["projects", "preferences"] as const;

/** Hands the sidebar layout to the native tab bar; a no-op off the iPad sidebar. */
export function configureSidebar() {
	if (!IPAD_SIDEBAR) return;
	TabSidebar?.configure({
		sidebarOnly: [...SIDEBAR_ONLY],
		openInLandscape: true,
	});
}

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

/** Page actions that are not adds: they stay in the bar beside the plus. */
const STAY_IN_BAR = new Set(["search", "converter", "notifications"]);

/**
 * One plus per header. Where the toolbar carries the global add (the iPad),
 * a page's own add action (Add recurring expense, Add person, Add account)
 * moves to the front of its overflow menu instead of drawing a second plus
 * next to the global one.
 */
export function singleAdd(
	control: AddControl,
	actions: readonly TopBarAction[],
	overflow: readonly MenuItem[],
): { actions: TopBarAction[]; overflow: MenuItem[] } {
	if (control !== "toolbar") {
		return { actions: [...actions], overflow: [...overflow] };
	}
	const stay = actions.filter((action) => STAY_IN_BAR.has(action.id));
	const adds = actions.filter((action) => !STAY_IN_BAR.has(action.id));
	return {
		actions: stay,
		overflow: [
			...adds.map(({ id, label, onPress }) => ({ id, label, onPress })),
			...overflow,
		],
	};
}
