import { requireOptionalNativeModule } from "expo";

export interface SidebarConfig {
	/** Route names that show in the sidebar only, not in the top tab bar. */
	sidebarOnly: string[];
	/** Open the sidebar at launch when the iPad is in landscape. */
	openInLandscape: boolean;
}

interface TabSidebarNative {
	/**
	 * True on iPadOS 26.1 and later with the react-native-screens build this
	 * module knows (the UITab path, where each tab has a placement).
	 */
	isSupported(): boolean;
	configure(config: SidebarConfig): void;
}

/** The iOS module; null on Android, in tests and where it is not built in. */
export const TabSidebar =
	requireOptionalNativeModule<TabSidebarNative>("TabSidebar");
