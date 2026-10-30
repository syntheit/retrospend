import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";

/**
 * Settings pushes over the tabs (the toast and the sheets live in the root
 * view, so it is not a native modal): swipe back or the system back leaves.
 * The list of sections has the large title on iOS; every page under it has
 * an inline title (GUIDELINE 15).
 *
 * The bar is the system's, as in the tab stacks: on iOS an opaque
 * `headerStyle` paints over the large title and leaves a blank band, so only
 * Android gets the flat theme-colored bar. The first screen's back button
 * comes from the root stack (it shows the route name "(tabs)" as its label,
 * so the label is dropped and the arrow stands alone).
 */
export default function SettingsLayout() {
	const t = useTranslations("mobile.settings");
	const { color } = useTheme();
	const android = Platform.OS === "android";
	return (
		<Stack
			screenOptions={{
				headerShadowVisible: false,
				headerTintColor: color.fg,
				headerStyle: android ? { backgroundColor: color.bg } : undefined,
				contentStyle: { backgroundColor: color.bg },
			}}
		>
			<Stack.Screen
				name="index"
				options={{
					title: t("title"),
					headerLargeTitle: !android,
					headerBackButtonDisplayMode: "minimal",
				}}
			/>
			<Stack.Screen name="profile" options={{ title: t("profile.title") }} />
			<Stack.Screen
				name="preferences"
				options={{ title: t("root.preferences") }}
			/>
			<Stack.Screen
				name="categories"
				options={{ title: t("manage.categories") }}
			/>
			<Stack.Screen
				name="payment-methods"
				options={{ title: t("manage.payment") }}
			/>
			<Stack.Screen
				name="notifications"
				options={{ title: t("root.notifications") }}
			/>
			<Stack.Screen name="security" options={{ title: t("security.title") }} />
			<Stack.Screen
				name="sessions"
				options={{ title: t("security.sessions.title") }}
			/>
			<Stack.Screen name="data" options={{ title: t("data.title") }} />
			<Stack.Screen name="danger" options={{ title: t("root.danger") }} />
		</Stack>
	);
}
