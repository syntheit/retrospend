import { Stack } from "expo-router";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";

/**
 * Settings pushes over the tabs (the toast and the sheets live in the root
 * view, so it is not a native modal): swipe back or the system back leaves.
 */
export default function SettingsLayout() {
	const t = useTranslations("mobile.settings");
	const { color } = useTheme();
	return (
		<Stack
			screenOptions={{
				headerShadowVisible: false,
				headerTintColor: color.fg,
				headerStyle: { backgroundColor: color.bg },
				contentStyle: { backgroundColor: color.bg },
			}}
		>
			<Stack.Screen name="index" options={{ title: t("title") }} />
		</Stack>
	);
}
