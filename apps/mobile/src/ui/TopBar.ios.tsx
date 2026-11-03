import { Stack } from "expo-router";
import { Platform, View } from "react-native";
import { useTranslations } from "use-intl";
import { useOptionalAddEntry } from "@/features/entry/AddEntryProvider";
import { singleAdd } from "@/layout/destinations";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { AccountButton } from "./AccountButton";
import { AddButton } from "./AddButton";
import { useInPair } from "./ListDetail";
import { Menu } from "./Menu";
import { PaneBar } from "./PaneBar";
import { TopBarAction } from "./TopBarAction";
import type { TopBarProps } from "./types";

/**
 * iOS navigation bar: the system large title (Liquid Glass bar material on
 * iOS 26) with the page's icon actions, overflow menu and the account button trailing it. Render it inside a screen. In
 * a list-detail pair the native bar would span both panes, so it is hidden and
 * the list pane draws this title and toolbar itself (ListDetail's `bar`).
 */
export function TopBar({
	title,
	actions,
	overflow,
	overflowLabel,
	account,
	accountLabel,
	onAccountPress,
}: TopBarProps) {
	const t = useTranslations("mobile.composer");
	const { space } = useTheme();
	const inPair = useInPair();
	const { columns } = useLayoutClass();
	const add = useOptionalAddEntry();
	// The iPad has no tab-bar plus (its bar is a top bar that overflows), so
	// the toolbar carries it next to the account button.
	const showAdd = Platform.OS === "ios" && Platform.isPad && add !== null;
	// With the toolbar's plus drawn, a page's own add goes into the overflow.
	const { actions: pageActions, overflow: items } = singleAdd(
		showAdd ? "toolbar" : "floating",
		actions ?? [],
		overflow ?? [],
	);
	const hasOverflow = items.length > 0;
	const hasTrailing =
		showAdd || account || hasOverflow || pageActions.length > 0;
	const buttons = () => (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: space[2],
			}}
		>
			{pageActions.map((action) => (
				<TopBarAction key={action.id} {...action} />
			))}
			{showAdd ? (
				<AddButton
					label={t("add")}
					onPress={() => add?.open("expense")}
					// The word fits beside the plus from expanded; in the portrait tab bar row it is the plus alone.
					showLabel={columns}
				/>
			) : null}
			{hasOverflow ? (
				<Menu
					accessibilityLabel={overflowLabel ?? title}
					icon
					items={items}
					label={overflowLabel ?? title}
				/>
			) : null}
			{account ? (
				<AccountButton
					face={account}
					label={accountLabel ?? title}
					onPress={onAccountPress}
				/>
			) : null}
		</View>
	);
	if (inPair) {
		return (
			<>
				<Stack.Screen options={{ headerShown: false }} />
				<PaneBar title={title} trailing={hasTrailing ? buttons() : undefined} />
			</>
		);
	}
	return (
		<Stack.Screen
			options={{
				title,
				headerLargeTitle: true,
				headerShadowVisible: false,
				headerRight: hasTrailing ? buttons : undefined,
			}}
		/>
	);
}
