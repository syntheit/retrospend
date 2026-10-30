import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useTheme } from "@/theme";

/**
 * The stack inside one tab. iOS gets the system large title and its own bar
 * material (Liquid Glass on iOS 26); Android gets a flat top bar on the
 * theme background, as in Material 3.
 */
export function TabStack({ title }: { title: string }) {
	const { color } = useTheme();
	const android = Platform.OS === "android";
	return (
		<Stack
			screenOptions={{
				// A pushed page names itself; until it does the bar is blank, never the route ("[id]").
				title: "",
				// A page pushed inside the tab has the inline title and the system
				// back button; only the tab's own list has the large one.
				headerLargeTitle: false,
				headerShadowVisible: false,
				headerTintColor: color.fg,
				headerStyle: android ? { backgroundColor: color.bg } : undefined,
				contentStyle: { backgroundColor: color.bg },
			}}
		>
			<Stack.Screen
				name="index"
				options={{ title, headerLargeTitle: !android }}
			/>
		</Stack>
	);
}
