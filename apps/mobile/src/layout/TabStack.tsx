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
				headerLargeTitle: !android,
				headerShadowVisible: false,
				headerTintColor: color.fg,
				headerStyle: android ? { backgroundColor: color.bg } : undefined,
				contentStyle: { backgroundColor: color.bg },
			}}
		>
			<Stack.Screen name="index" options={{ title }} />
		</Stack>
	);
}
