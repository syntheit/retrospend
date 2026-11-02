import { useSegments } from "expo-router";
import { Tabs as JsTabs } from "expo-router/js-tabs";
import { useEffect } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { type FloatingTab, FloatingTabBar } from "./FloatingTabBar";
import { TabBarCoverContext, tabBarFootprint } from "./tabBarMetrics";
import { closeTransients } from "./transient";
import { useKeyboardShown } from "./useKeyboardShown";

/** Routes under app/(tabs) that are not in the bar on a phone. */
const OFF_BAR = [
	"currencies",
	"insights",
	"preferences",
	"projects",
	"recurring",
] as const;

/**
 * The Android tabs: the same five destinations as iOS (Home, Activity,
 * Budget, Wealth, People; Projects is the second segment of People), in the
 * floating pill of ui/FloatingTabBar. It is a custom bar over the JS tab
 * navigator, because the native one draws the full-width Material bar whose
 * indicator wraps only the icon.
 *
 * Each tab keeps its stack and scroll while another is open. Tapping the
 * open tab pops it to its root (the bar emits `tabPress`, which the stack
 * hears) and tapping again scrolls to the top (ui/scrollToTop). System back
 * pops the stack, then returns to Home, then leaves. Leaving a tab closes
 * its passing UI: an open swipe row, a menu, bulk select (ui/transient).
 * The screens run behind the bar and pad their ends by the cover it
 * reports, so the last row stays reachable.
 */
export function Tabs() {
	const t = useTranslations("mobile.tabs");
	const tw = useTranslations("mobile.wealth");
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const keyboard = useKeyboardShown();
	const tab = (useSegments() as string[])[1];
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on each tab switch
	useEffect(() => closeTransients(), [tab]);

	const tabs: FloatingTab[] = [
		{ name: "home", label: t("home"), glyph: "Home" },
		{ name: "activity", label: t("activity"), glyph: "ReceiptText" },
		{ name: "budget", label: t("budget"), glyph: "ChartPie" },
		{ name: "wealth", label: tw("title"), glyph: "Landmark" },
		{ name: "people", label: t("people"), glyph: "Users" },
	];
	const cover = keyboard ? 0 : insets.bottom + tabBarFootprint(theme);

	return (
		<TabBarCoverContext.Provider value={cover}>
			<JsTabs
				backBehavior="initialRoute"
				screenOptions={{
					headerShown: false,
					sceneStyle: { backgroundColor: theme.color.bg },
				}}
				tabBar={(bar) => (
					<FloatingTabBar
						emitter={bar.emitter}
						insets={bar.insets}
						navigateToTab={bar.navigateToTab}
						state={bar.state}
						tabs={tabs}
					/>
				)}
			>
				{OFF_BAR.map((name) => (
					<JsTabs.Screen key={name} name={name} options={{ href: null }} />
				))}
			</JsTabs>
		</TabBarCoverContext.Provider>
	);
}
