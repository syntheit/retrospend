import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Platform } from "react-native";
import { useTranslations } from "use-intl";
import { PROJECTS_APART } from "@/layout/destinations";
import { useTheme } from "@/theme";

interface TabsProps {
	/** Called when the trailing plus is pressed (iOS only). */
	onAdd(): void;
	/** The plus tab's accessibility label ("Add expense"). */
	addLabel: string;
}

/**
 * Four destinations on phones: Home, Activity, Budget and People (Projects is
 * the second segment of People, see PeopleHub). The iPad sidebar lists all
 * six, Projects and Wealth included.
 *
 * Add on iPhone is the system's detached trailing tab: react-native-screens
 * 4.29+ backs `role: "search"` with a UISearchTab, which iOS 26 and 27 detach
 * at the end of the bar (no search bar is set, so it never opens a field).
 * expo-router only forwards the role as a UITabBarItem system item, so the
 * native role goes through unstable_nativeProps. The trigger is `disabled`:
 * the native side keeps the selected tab and reports the press, and that
 * press opens the composer. The bar holds five items including this tab; a
 * sixth tab sends the plus and the last destination into More (verified on
 * iOS 26.5 and 27.0), which is why phones stop at four destinations.
 *
 * Android has no such slot and keeps its extended FAB; the iPad has the plus
 * in the toolbar (AddEntryProvider, TopBar). Active nav is brand
 * (GUIDELINE §2.1); the bar itself is a theme surface.
 */
export function Tabs({ onAdd, addLabel }: TabsProps) {
	const t = useTranslations("mobile.tabs");
	const { color } = useTheme();
	// Android draws an M3 navigation bar in token colors; iOS keeps the
	// system bar material and takes only the brand tint.
	const m3 = Platform.OS === "android";
	// The iPad sidebar shows all six destinations; phones show four.
	const ipad = Platform.OS === "ios" && Platform.isPad;
	const iphone = Platform.OS === "ios" && !Platform.isPad;
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
			{PROJECTS_APART ? (
				<NativeTabs.Trigger name="projects">
					<NativeTabs.Trigger.Label>{t("projects")}</NativeTabs.Trigger.Label>
					<NativeTabs.Trigger.Icon md="folder" sf="folder" />
				</NativeTabs.Trigger>
			) : null}
			{iphone ? (
				<NativeTabs.Trigger
					accessibilityLabel={addLabel}
					disabled
					listeners={{ tabPress: onAdd }}
					name="add"
					testID="add-tab"
					unstable_nativeProps={{
						ios: { role: "search", automaticallyActivatesSearch: true },
					}}
				>
					<NativeTabs.Trigger.Label>{addLabel}</NativeTabs.Trigger.Label>
					<NativeTabs.Trigger.Icon sf="plus" />
				</NativeTabs.Trigger>
			) : null}
		</NativeTabs>
	);
}
