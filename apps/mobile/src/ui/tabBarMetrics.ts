import {
	createContext,
	useContext,
	useEffect,
	useSyncExternalStore,
} from "react";
import { Platform } from "react-native";
import type { Theme } from "@/theme";
import { HAIRLINE } from "./metrics";

/** The iOS system tab bar's height; the floating Add button sits above it. */
const IOS_BAR_HEIGHT = 49;

/**
 * The geometry of the Android floating tab bar (ui/FloatingTabBar), from the
 * space tokens: a pill inset by 12 from each side and 8 above the gesture
 * area, whose tabs are 60 tall (the 48 touch target plus room for the label
 * to grow) inside 4 of padding and a 1 point hairline.
 */
export function floatingBarMetrics(theme: Theme) {
	const { space } = theme;
	const tab = space[12] + space[3];
	const border = HAIRLINE;
	const height = tab + space[1] * 2 + border * 2;
	return {
		sideGap: space[3],
		bottomGap: space[2],
		padding: space[1],
		border,
		tab,
		height,
		/** From the top of the gesture area up to the top of the bar. */
		footprint: space[2] + height,
	};
}

/**
 * How far the bar's top sits above the bottom inset: what the Add button and
 * the Undo toast clear. The Android pill, or the iOS system bar.
 */
export function tabBarFootprint(
	theme: Theme,
	os: string = Platform.OS,
): number {
	return os === "android"
		? floatingBarMetrics(theme).footprint
		: IOS_BAR_HEIGHT;
}

/**
 * How much of the bottom of a tab screen the floating bar covers (its
 * footprint plus the gesture area), since the screens run behind it. Zero
 * outside the tabs and on iOS, whose system bar insets its scroll views itself.
 */
export const TabBarCoverContext = createContext(0);

export function useTabBarCover(): number {
	return useContext(TabBarCoverContext);
}

// A full-screen view over a tab root (the expanded search view) hides the bar,
// as the keyboard does; the bar and the screens' cover read the same count.
let hiders = 0;
const listeners = new Set<() => void>();
const emit = () => {
	for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/** Hides the floating tab bar while `hidden` is true. */
export function useHideTabBar(hidden = true) {
	useEffect(() => {
		if (!hidden) return;
		hiders += 1;
		emit();
		return () => {
			hiders -= 1;
			emit();
		};
	}, [hidden]);
}

/** True while a full-screen view has hidden the floating tab bar. */
export function useTabBarHidden(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => hiders > 0,
		() => false,
	);
}
