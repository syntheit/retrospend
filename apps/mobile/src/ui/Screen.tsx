import type { ReactNode } from "react";
import { ScrollView } from "react-native";
import { useTheme } from "@/theme";

/**
 * A scrolling screen body on the theme background. On iOS the first scroll
 * view adjusts for the large title and the tab bar by itself.
 */
export function Screen({ children }: { children?: ReactNode }) {
	const { color, space } = useTheme();
	return (
		<ScrollView
			contentContainerStyle={{ padding: space[4], gap: space[4] }}
			contentInsetAdjustmentBehavior="automatic"
			keyboardShouldPersistTaps="handled"
			style={{ flex: 1, backgroundColor: color.bg }}
		>
			{children}
		</ScrollView>
	);
}
