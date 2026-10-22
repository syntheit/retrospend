import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Platform } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";

/**
 * Five destinations on every device (N65): Home, Activity, Budget, People,
 * Projects. iPhone gets a trailing "+" item; iOS 26 sets the search-role
 * item apart at the trailing end, so the "+" uses that slot with its own
 * icon and label. Android adds with an extended FAB instead (platform UI
 * layer), so the item is hidden there. iPad turns the bar into a sidebar.
 */
export default function TabsLayout() {
	const t = useTranslations("mobile.tabs");
	const { color } = useTheme();

	return (
		<NativeTabs
			backBehavior="initialRoute"
			indicatorColor={color.accentSoft}
			sidebarAdaptable
			tintColor={color.accent}
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
				hidden={Platform.OS === "android"}
				name="add"
				role="search"
			>
				<NativeTabs.Trigger.Icon md="add" sf="plus" />
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
