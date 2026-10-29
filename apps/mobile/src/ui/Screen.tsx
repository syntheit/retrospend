import type { ReactNode } from "react";
import { Platform, RefreshControl, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ADD_CONTROL } from "@/layout/destinations";
import { useTheme } from "@/theme";
import { useSidesCleared } from "./ListDetail";

/**
 * Room a scrolling list leaves under its last row on phones, where the add
 * control floats above the tab bar (the iOS glass button, the M3 FAB): the
 * control's 48 point height, its 16 point margin and 16 of air, so it never
 * covers a row's money at the end of the list. Zero on iPad, whose plus sits
 * in the toolbar. Lists that are not a Screen add it as their footer.
 */
export function useAddInset(): number {
	const { space } = useTheme();
	return ADD_CONTROL === "floating" ? space[12] + space[4] + space[4] : 0;
}

/**
 * A scrolling screen body on the theme background. On iOS the first scroll
 * view adjusts for the large title and the tab bar by itself, but not for the
 * sides. Android is edge-to-edge, so the body pads for the gesture bar too;
 * the native SafeAreaView measures what is actually covered, so a tab screen
 * whose container already sits above the navigation bar gets no extra bottom
 * padding. The body always ends with the add control's inset.
 * `flush` leaves out the side padding, for lists whose rows pad themselves.
 * `onRefresh` turns on pull to refresh; `refreshing` shows its spinner while
 * the reload runs.
 */
export function Screen({
	children,
	flush,
	refreshing = false,
	onRefresh,
}: {
	children?: ReactNode;
	flush?: boolean;
	refreshing?: boolean;
	onRefresh?: () => void;
}) {
	const { color, space } = useTheme();
	const cleared = useSidesCleared();
	const inset = useAddInset();
	const body = (
		<ScrollView
			contentContainerStyle={
				flush
					? { paddingBottom: space[8] + inset }
					: {
							padding: space[4],
							paddingBottom: space[4] + inset,
							gap: space[4],
						}
			}
			contentInsetAdjustmentBehavior="automatic"
			keyboardShouldPersistTaps="handled"
			refreshControl={
				onRefresh ? (
					<RefreshControl
						colors={[color.fg2]}
						onRefresh={onRefresh}
						progressBackgroundColor={color.surface}
						refreshing={refreshing}
						tintColor={color.fg2}
					/>
				) : undefined
			}
			style={{ flex: 1, backgroundColor: color.bg }}
		>
			{children}
		</ScrollView>
	);
	// The native SafeAreaView clears only what covers it: the iPad sidebar that
	// floats over the content, a landscape notch, Android's bars. A screen in
	// the detail pane is cleared by its ListDetail already.
	if (cleared && Platform.OS !== "android") return body;
	return (
		<SafeAreaView
			edges={
				Platform.OS === "android"
					? ["left", "right", "bottom"]
					: ["left", "right"]
			}
			style={{ flex: 1, backgroundColor: color.bg }}
		>
			{body}
		</SafeAreaView>
	);
}
