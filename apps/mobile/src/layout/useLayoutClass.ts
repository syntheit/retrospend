import { Platform, useWindowDimensions } from "react-native";

/**
 * Window width classes, with Android's breakpoints (dp): compact under 600,
 * medium under 840, expanded from 840. An iPhone is compact in either
 * orientation (852pt wide in landscape is still compact on iOS); an iPad Air
 * 11 is medium in portrait (820) and expanded in landscape (1180); Stage
 * Manager and Slide Over windows move between them.
 */
export type WidthClass = "compact" | "medium" | "expanded";

export interface LayoutClass {
	widthClass: WidthClass;
	/** List and detail side by side (Activity, People, Projects). */
	listDetail: boolean;
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
 * iPhone is always compact. iPad goes list-detail at the regular size class
 * (any width from medium, as in full-screen portrait); Android from expanded
 * (mobile/01, S5 concern table).
 */
export function layoutFor(width: number, device: Device): LayoutClass {
	if (device.os === "ios" && !device.isPad) {
		return { widthClass: "compact", listDetail: false };
	}
	const widthClass = widthClassFor(width);
	const listDetail =
		device.os === "android"
			? widthClass === "expanded"
			: widthClass !== "compact";
	return { widthClass, listDetail };
}

export function useLayoutClass(): LayoutClass {
	const { width } = useWindowDimensions();
	const isPad = Platform.OS === "ios" && Platform.isPad;
	return layoutFor(width, { os: Platform.OS, isPad });
}
