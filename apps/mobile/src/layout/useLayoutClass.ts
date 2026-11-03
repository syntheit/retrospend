import { Platform, useWindowDimensions } from "react-native";

/**
 * Window width classes, with Android's breakpoints (dp): compact under 600,
 * medium under 840, expanded from 840. An iPhone is compact in either
 * orientation (852pt wide in landscape is still compact on iOS); an iPad Air
 * 11 is medium in portrait (820) and expanded in landscape (1180); Stage
 * Manager, Split View and Slide Over windows move between them live, because
 * the class is read from the window size.
 */
export type WidthClass = "compact" | "medium" | "expanded";

/**
 * Where the destinations live. The iPad's chrome is the system tab bar that
 * adapts into a sidebar ("native"); on Android tablets it is a sidebar
 * (landscape, expanded) or a compact rail (everything else from medium).
 */
export type Navigation = "bar" | "rail" | "sidebar" | "native";

export interface LayoutClass {
	widthClass: WidthClass;
	/** A tablet window: medium or expanded on an iPad or an Android tablet. */
	tablet: boolean;
	navigation: Navigation;
	/** List and detail side by side (Activity, People, Projects, Settings). */
	listDetail: boolean;
	/** Home in two columns, Budget with an envelope inspector. */
	columns: boolean;
}

export interface Device {
	os: typeof Platform.OS;
	/** iOS only: the app runs on an iPad (any window size). */
	isPad: boolean;
}

export function widthClassFor(width: number): WidthClass {
	if (width < 600) return "compact";
	if (width < 840) return "medium";
	return "expanded";
}

/**
 * iPhone is always compact. Every other device reads the window: a tablet
 * goes list-detail from medium on both platforms, and gets a second column
 * (Home) and an inspector (Budget) at expanded.
 */
export function layoutFor(
	width: number,
	device: Device,
	height = 0,
): LayoutClass {
	if (device.os === "ios" && !device.isPad) {
		return {
			widthClass: "compact",
			tablet: false,
			navigation: "bar",
			listDetail: false,
			columns: false,
		};
	}
	const widthClass = widthClassFor(width);
	const tablet = widthClass !== "compact";
	const landscape = width > height;
	const navigation: Navigation =
		device.os === "ios"
			? "native"
			: !tablet
				? "bar"
				: widthClass === "expanded" && landscape
					? "sidebar"
					: "rail";
	return {
		widthClass,
		tablet,
		navigation,
		listDetail: tablet,
		columns: widthClass === "expanded",
	};
}

export function useLayoutClass(): LayoutClass {
	const { width, height } = useWindowDimensions();
	const isPad = Platform.OS === "ios" && Platform.isPad;
	return layoutFor(width, { os: Platform.OS, isPad }, height);
}
