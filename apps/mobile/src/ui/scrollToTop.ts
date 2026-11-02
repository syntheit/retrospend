import { NavigationContext } from "expo-router/react-navigation";
import { useCallback, useContext, useEffect, useRef } from "react";
import { Platform } from "react-native";

/**
 * Tapping the open tab again scrolls its list to the top. iOS's native tab
 * bar does that itself; Android's floating bar (ui/FloatingTabBar) calls
 * `scrollFocusedToTop`, and every tab-level list registers here with
 * `useScrollToTop`. Only a list whose screen is on top answers.
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

interface Scrollable {
	scrollTo?: (options: { y: number; animated: boolean }) => void;
	scrollToOffset?: (options: { offset: number; animated: boolean }) => void;
	getScrollResponder?: () => unknown;
}

/**
 * Registers a list as a scroll-to-top target: pass the returned function as
 * the `ref` of a ScrollView, FlatList or SectionList.
 */
export function useScrollToTop(): (node: Scrollable | null) => void {
	const navigation = useContext(NavigationContext);
	const node = useRef<Scrollable | null>(null);
	const setNode = useCallback((next: Scrollable | null) => {
		node.current = next;
	}, []);
	useEffect(() => {
		if (Platform.OS !== "android" || !navigation) return;
		const target: Target = {
			navigation,
			scroll: () => {
				const list = node.current;
				if (!list) return;
				if (list.scrollToOffset) {
					list.scrollToOffset({ offset: 0, animated: true });
				} else if (list.scrollTo) {
					list.scrollTo({ y: 0, animated: true });
				} else {
					(list.getScrollResponder?.() as Scrollable | null)?.scrollTo?.({
						y: 0,
						animated: true,
					});
				}
			},
		};
		targets.add(target);
		return () => {
			targets.delete(target);
		};
	}, [navigation]);
	return setNode;
}
