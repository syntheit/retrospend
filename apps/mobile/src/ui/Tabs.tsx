import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Platform } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";

/**
 * Five destinations on every device (N65): Home, Activity, Budget, People,
 * Projects. iPhone gets a trailing "+" item: iOS 26 sets the search-role
 * item apart at the trailing end, so the "+" uses that slot with its own
 * icon, and its accessibility label replaces the system "Search". Android
 * adds with an extended FAB and iPad with a toolbar button instead (platform
 * UI layer), so the item is hidden there. iPad turns the bar into a sidebar.
 * Active nav is brand (GUIDELINE §2.1); the bar itself is a theme surface.
 */
export function Tabs() {
	const t = useTranslations("mobile.tabs");
	const { color } = useTheme();
	const iPhone = Platform.OS === "ios" && !Platform.isPad;
	// Android draws an M3 navigation bar in token colors; iOS keeps the
	// system bar material and takes only the brand tint.
	const m3 = Platform.OS === "android";

	return (
		<NativeTabs
			backBehavior="initialRoute"
			backgroundColor={m3 ? color.surface : undefined}
			badgeBackgroundColor={color.attention}
			iconColor={m3 ? { default: color.fg2, selected: color.brand } : undefined}
			indicatorColor={color.brandSoft}
			labelStyle={
				m3
					? { default: { color: color.fg2 }, selected: { color: color.brand } }
					: undefined
			}
			rippleColor={color.brandSoft}
			sidebarAdaptable
			tintColor={color.brand}
		>
			<NativeTabs.Trigger name="home">
				<NativeTabs.Trigger.Label>{t("home")}</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon md="home" sf="house" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="activity">
				<NativeTabs.Trigger.Label>{t("activity")}</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon md="receipt_long" sf="list.bullet" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="budget">
				<NativeTabs.Trigger.Label>{t("budget")}</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon md="donut_large" sf="chart.pie" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="people">
				<NativeTabs.Trigger.Label>{t("people")}</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon md="group" sf="person.2" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="projects">
				<NativeTabs.Trigger.Label>{t("projects")}</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon md="folder" sf="folder" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger
				accessibilityLabel={t("add")}
				hidden={!iPhone}
				name="add"
				role="search"
			>
				<NativeTabs.Trigger.Label>{t("add")}</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon md="add" sf="plus" />
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
