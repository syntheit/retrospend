import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Platform } from "react-native";
import { useTranslations } from "use-intl";
import { PROJECTS_APART, RECURRING_APART } from "@/layout/destinations";
import { useTheme } from "@/theme";

/**
 * Five destinations on phones: Home, Activity, Budget, Wealth and People
 * (Projects is the second segment of People, see PeopleHub). The iPad sidebar
 * lists Projects and Recurring as well.
 *
 * Add is not a tab: five tabs fill the iPhone's bar and a sixth goes into
 * More, so the add button floats above the bar (AddEntryProvider). Active nav
 * is brand (GUIDELINE §2.1); the bar itself is a theme surface.
 */
export function Tabs() {
	const t = useTranslations("mobile.tabs");
	const { color } = useTheme();
	// Android draws an M3 navigation bar in token colors; iOS keeps the
	// system bar material and takes only the brand tint.
	const m3 = Platform.OS === "android";
	const tw = useTranslations("mobile.wealth");

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
			labelVisibilityMode="labeled"
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
			<NativeTabs.Trigger name="wealth">
				<NativeTabs.Trigger.Label>{tw("title")}</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon
					md="account_balance"
					sf="chart.line.uptrend.xyaxis"
				/>
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="people">
				<NativeTabs.Trigger.Label>{t("people")}</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon md="group" sf="person.2" />
			</NativeTabs.Trigger>
			{PROJECTS_APART ? (
				<NativeTabs.Trigger name="projects">
					<NativeTabs.Trigger.Label>{t("projects")}</NativeTabs.Trigger.Label>
					<NativeTabs.Trigger.Icon md="folder" sf="folder" />
				</NativeTabs.Trigger>
			) : null}
			{RECURRING_APART ? (
				<NativeTabs.Trigger name="recurring">
					<NativeTabs.Trigger.Label>{t("recurring")}</NativeTabs.Trigger.Label>
					<NativeTabs.Trigger.Icon md="repeat" sf="repeat" />
				</NativeTabs.Trigger>
			) : null}
		</NativeTabs>
	);
}
