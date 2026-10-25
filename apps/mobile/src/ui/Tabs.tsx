import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Platform } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";

/**
 * Five destinations on every device (N65): Home, Activity, Budget, People,
 * Projects. Add is not a tab: iOS holds five slots, and react-native-screens
 * 4.26 builds a "search" tab as a plain sixth tab (a UITabBarItem system
 * item, not a UISearchTab), which folds Projects into More. The Add route
 * stays here, hidden, and AddEntryProvider floats the add button above the bar.
 * iPad turns the bar into a sidebar. Active nav is brand (GUIDELINE §2.1);
 * the bar itself is a theme surface.
 */
export function Tabs() {
	const t = useTranslations("mobile.tabs");
	const { color } = useTheme();
	// Android draws an M3 navigation bar in token colors; iOS keeps the
	// system bar material and takes only the brand tint.
	const m3 = Platform.OS === "android";
	// The iPad sidebar shows all six destinations; the phone bar keeps five.
	const ipad = Platform.OS === "ios" && Platform.isPad;
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
			{ipad ? (
				<NativeTabs.Trigger name="wealth">
					<NativeTabs.Trigger.Label>{tw("title")}</NativeTabs.Trigger.Label>
					<NativeTabs.Trigger.Icon
						md="account_balance"
						sf="chart.line.uptrend.xyaxis"
					/>
				</NativeTabs.Trigger>
			) : null}
			<NativeTabs.Trigger name="people">
				<NativeTabs.Trigger.Label>{t("people")}</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon md="group" sf="person.2" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="projects">
				<NativeTabs.Trigger.Label>{t("projects")}</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon md="folder" sf="folder" />
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
