import { useSegments } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useEffect } from "react";
import { Platform } from "react-native";
import { useTranslations } from "use-intl";
import { configureSidebar, IPAD_SIDEBAR } from "@/layout/destinations";
import { useTheme } from "@/theme";
import { closeTransients } from "./transient";

/**
 * Five destinations in the bar on every device: Home, Activity, Budget,
 * Wealth and People. On phones Projects is the second segment of People.
 *
 * The iPad's floating tab bar holds the same five, so it does not scroll, and
 * adapts into a sidebar (the toggle at its leading edge; open at launch in
 * landscape only). The sidebar adds Projects and Settings, which show there
 * only (layout/destinations, modules/tab-sidebar).
 *
 * Add is not a tab: five tabs fill the iPhone's bar and a sixth goes into
 * More, so the add button floats above the bar (AddEntryProvider); the iPad
 * keeps it in the toolbar. Active nav is brand (GUIDELINE §2.1); the bar
 * itself is a theme surface.
 *
 * Each tab keeps its stack and scroll while another is open (native tabs).
 * Tapping the open tab pops it to its root, and tapping again scrolls to the
 * top (the native repeated-selection effects, on by default on both
 * platforms). Leaving a tab closes its passing UI: an open swipe row, a menu,
 * bulk select (ui/transient). An iPad's list-detail selection stays.
 */
export function Tabs() {
	const t = useTranslations("mobile.tabs");
	const tw = useTranslations("mobile.wealth");
	const ts = useTranslations("mobile.settings");
	const { color } = useTheme();
	// Android draws an M3 navigation bar in token colors; iOS keeps the
	// system bar material and takes only the brand tint.
	const m3 = Platform.OS === "android";
	const tab = (useSegments() as string[])[1];
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on each tab switch
	useEffect(() => closeTransients(), [tab]);
	// Before the native tabs mount, so the first install has the layout.
	configureSidebar();

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
				{/* iPad lists Projects on its own, so this tab is People there. */}
				<NativeTabs.Trigger.Label>
					{IPAD_SIDEBAR ? t("peopleSegment") : t("people")}
				</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon md="group" sf="person.2" />
			</NativeTabs.Trigger>
			{IPAD_SIDEBAR ? (
				<NativeTabs.Trigger name="projects">
					<NativeTabs.Trigger.Label>{t("projects")}</NativeTabs.Trigger.Label>
					<NativeTabs.Trigger.Icon md="folder" sf="folder" />
				</NativeTabs.Trigger>
			) : null}
			{IPAD_SIDEBAR ? (
				<NativeTabs.Trigger name="preferences">
					<NativeTabs.Trigger.Label>{ts("title")}</NativeTabs.Trigger.Label>
					<NativeTabs.Trigger.Icon md="settings" sf="gearshape" />
				</NativeTabs.Trigger>
			) : null}
		</NativeTabs>
	);
}
