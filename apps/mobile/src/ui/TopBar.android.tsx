import { Stack } from "expo-router";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { AccountButton } from "./AccountButton";
import { useCollapsingBar } from "./barScroll";
import { CollapsingBar, RevealOnCollapse } from "./CollapsingBar";
import { useInPair } from "./ListDetail";
import { Menu } from "./Menu";
import { PaneBar } from "./PaneBar";
import { TopBarAction } from "./TopBarAction";
import type { TopBarProps } from "./types";

/**
 * Android top app bar. A tab root (inside a CollapsingBarProvider, on a phone)
 * gets the Material 3 large bar: the title under the icon row, shrinking into
 * the small bar as the list scrolls (CollapsingBar). A page pushed over it
 * keeps the system's small bar: flat on the theme background, the back arrow,
 * the title at the start, the overflow menu and account avatar at the end. In
 * a list-detail pair the list pane draws its own bar (ListDetail's `bar`).
 */
export function TopBar({
	title,
	actions,
	overflow,
	overflowLabel,
	account,
	accountLabel,
	onAccountPress,
	footer,
}: TopBarProps) {
	const { color, space } = useTheme();
	const inPair = useInPair();
	const collapsing = useCollapsingBar() !== null;
	const items = overflow ?? [];
	const pageActions = actions ?? [];
	const hasTrailing = items.length > 0 || pageActions.length > 0 || account;
	const buttons = () => (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
			{pageActions.map((action) =>
				action.revealOnCollapse && collapsing ? (
					<RevealOnCollapse key={action.id}>
						<TopBarAction {...action} />
					</RevealOnCollapse>
				) : (
					<TopBarAction key={action.id} {...action} />
				),
			)}
			{items.length > 0 ? (
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
	if (collapsing) {
		return (
			<>
				<Stack.Screen options={{ headerShown: false }} />
				<CollapsingBar
					footer={footer}
					title={title}
					trailing={hasTrailing ? buttons() : undefined}
				/>
			</>
		);
	}
	return (
		<Stack.Screen
			options={{
				title,
				headerLargeTitle: false,
				headerShadowVisible: false,
				headerStyle: { backgroundColor: color.bg },
				headerTintColor: color.fg,
				headerRight: hasTrailing ? buttons : undefined,
			}}
		/>
	);
}
