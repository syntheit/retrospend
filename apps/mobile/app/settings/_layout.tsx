import { router, Stack } from "expo-router";
import { I18nManager, Platform, Pressable } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Glyph } from "@/ui/Glyph";

/**
 * Settings pushes over the tabs (the toast and the sheets live in the root
 * view, so it is not a native modal): swipe back or the back button leaves.
 * The list of sections has the large title on iOS; every page under it has
 * an inline title (GUIDELINE 15).
 *
 * The bar is the system's, as in the tab stacks: on iOS an opaque
 * `headerStyle` paints over the large title and leaves a blank band, so only
 * Android gets the flat theme-colored bar. The root stack hides its own
 * header and this stack's first screen has nothing behind it, so the list of
 * sections draws its own back button (the arrow alone) and leaves with
 * `router.back()`.
 */
/**
 * The way out of the first screen: the arrow alone, 44 points, labeled. The
 * glyph set has the right chevron only, so the arrow is turned around (and
 * left as it is in a right-to-left layout, where "back" points right).
 */
function LeaveSettings({ label }: { label: string }) {
	const { color, size } = useTheme();
	const target = size.touchMin.phone;
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityRole="button"
			onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
			style={({ pressed }) => ({
				width: target,
				height: target,
				borderRadius: target / 2,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: pressed ? color.raised : "transparent",
				transform: [{ rotate: I18nManager.isRTL ? "0deg" : "180deg" }],
			})}
		>
			<Glyph color={color.fg} name="ChevronRight" size={size.icon.phone} />
		</Pressable>
	);
}

export default function SettingsLayout() {
	const t = useTranslations("mobile.settings");
	const ta = useTranslations("mobile.admin");
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
					headerLeft: () => <LeaveSettings label={t("back")} />,
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
			<Stack.Screen name="admin" options={{ title: ta("title") }} />
			<Stack.Screen name="admin-users" options={{ title: ta("users.title") }} />
			<Stack.Screen
				name="admin-invites"
				options={{ title: ta("invites.title") }}
			/>
			<Stack.Screen
				name="admin-feedback"
				options={{ title: ta("feedback.title") }}
			/>
			<Stack.Screen
				name="admin-settings"
				options={{ title: ta("settings.title") }}
			/>
		</Stack>
	);
}
