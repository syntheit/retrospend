import { Stack } from "expo-router";
import { View } from "react-native";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { AccountButton } from "./AccountButton";
import { Menu } from "./Menu";
import { PaneBar } from "./PaneBar";
import type { TopBarProps } from "./types";

/**
 * Android top app bar: flat on the theme background, the title at the start
 * (M3 small top app bar) and the overflow menu and account avatar at the end. In a list-detail
 * pair the list pane draws its own bar (ListDetail's `bar`).
 */
export function TopBar({
	title,
	overflow,
	overflowLabel,
	account,
	accountLabel,
	onAccountPress,
}: TopBarProps) {
	const { color, space } = useTheme();
	const { listDetail } = useLayoutClass();
	const items = overflow ?? [];
	const hasTrailing = items.length > 0 || account;
	const buttons = () => (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
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
	if (listDetail) {
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
				headerLargeTitle: false,
				headerShadowVisible: false,
				headerStyle: { backgroundColor: color.bg },
				headerTintColor: color.fg,
				headerRight: hasTrailing ? buttons : undefined,
			}}
		/>
	);
}
