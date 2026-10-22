import { Platform, useWindowDimensions } from "react-native";

/**
 * Window width classes, with Android's breakpoints (dp): compact under 600,
 * medium under 840, expanded from 840. An iPhone in either orientation is
 * compact; an iPad Air 11 is medium in portrait (820) and expanded in
 * landscape (1180); Stage Manager and Slide Over windows move between them.
 */
export type WidthClass = "compact" | "medium" | "expanded";

export interface LayoutClass {
	widthClass: WidthClass;
	/** List and detail side by side (Activity, People, Projects). */
	listDetail: boolean;
}

export function widthClassFor(width: number): WidthClass {
	if (width < 600) return "compact";
	if (width < 840) return "medium";
	return "expanded";
}

/**
 * iPad goes list-detail at the regular size class (any width from medium, as
 * in full-screen portrait); Android from expanded (mobile/01, S5 concern table).
 */
export function layoutFor(width: number, os: typeof Platform.OS): LayoutClass {
	const widthClass = widthClassFor(width);
	const listDetail =
		os === "android" ? widthClass === "expanded" : widthClass !== "compact";
	return { widthClass, listDetail };
}

export function useLayoutClass(): LayoutClass {
	const { width } = useWindowDimensions();
	return layoutFor(width, Platform.OS);
}
