import type { ReactNode } from "react";
import { Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/theme";

/**
 * A scrolling screen body on the theme background. On iOS the first scroll
 * view adjusts for the large title and the tab bar by itself. Android is
 * edge-to-edge, so the body pads for the gesture bar and for side insets
 * (landscape cutouts, 3-button nav on the side); the native SafeAreaView
 * measures what is actually covered, so a tab screen whose container
 * already sits above the navigation bar gets no extra bottom padding.
 */
export function Screen({ children }: { children?: ReactNode }) {
	const { color, space } = useTheme();
	const body = (
		<ScrollView
			contentContainerStyle={{ padding: space[4], gap: space[4] }}
			contentInsetAdjustmentBehavior="automatic"
			keyboardShouldPersistTaps="handled"
			style={{ flex: 1, backgroundColor: color.bg }}
		>
			{children}
		</ScrollView>
	);
	if (Platform.OS !== "android") return body;
	return (
		<SafeAreaView
			edges={["left", "right", "bottom"]}
			style={{ flex: 1, backgroundColor: color.bg }}
		>
			{body}
		</SafeAreaView>
	);
}
