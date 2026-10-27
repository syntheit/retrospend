import type { ReactNode } from "react";
import { Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/theme";
import { useSidesCleared } from "./ListDetail";

/**
 * A scrolling screen body on the theme background. On iOS the first scroll
 * view adjusts for the large title and the tab bar by itself, but not for the
 * sides. Android is edge-to-edge, so the body pads for the gesture bar too;
 * the native SafeAreaView measures what is actually covered, so a tab screen
 * whose container already sits above the navigation bar gets no extra bottom
 * padding.
 * `flush` leaves out the side padding, for lists whose rows pad themselves.
 */
export function Screen({
	children,
	flush,
}: {
	children?: ReactNode;
	flush?: boolean;
}) {
	const { color, space } = useTheme();
	const cleared = useSidesCleared();
	const body = (
		<ScrollView
			contentContainerStyle={
				flush
					? { paddingBottom: space[8] }
					: { padding: space[4], gap: space[4] }
			}
			contentInsetAdjustmentBehavior="automatic"
			keyboardShouldPersistTaps="handled"
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
