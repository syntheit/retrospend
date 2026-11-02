import { NavigationContext } from "expo-router/react-navigation";
import { useContext, useEffect, useRef } from "react";
import { Platform } from "react-native";

/**
 * Tapping the open tab again scrolls its list to the top. iOS's native tab
 * bar does that itself; Android's floating bar (ui/FloatingTabBar) calls
 * `scrollFocusedToTop`, and every tab-level list registers here through the
 * Bar* scroll containers (ui/barScroll). Only a list whose screen is on top
 * answers. Scrolling to the top also re-expands the collapsing title, since
 * the bar follows the list's offset.
 */
interface Target {
	scroll: () => void;
	navigation: { isFocused: () => boolean } | undefined;
}

const targets = new Set<Target>();

/** Scrolls the lists on screen to the top (the open tab's root). */
export function scrollFocusedToTop() {
	for (const target of targets) {
		if (target.navigation?.isFocused()) target.scroll();
	}
}

/** Registers a list's "go to the top" as a target of the open-tab tap (Android). */
export function useScrollToTopTarget(scroll: () => void) {
	const navigation = useContext(NavigationContext);
	const latest = useRef(scroll);
	latest.current = scroll;
	useEffect(() => {
		if (Platform.OS !== "android" || !navigation) return;
		const target: Target = { navigation, scroll: () => latest.current() };
		targets.add(target);
		return () => {
			targets.delete(target);
		};
	}, [navigation]);
}
