import { Stack } from "expo-router";
import { Platform, View } from "react-native";
import { useTranslations } from "use-intl";
import { useOptionalAddEntry } from "@/features/entry/AddEntryProvider";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { AccountButton } from "./AccountButton";
import { AddButton } from "./AddButton";
import { PaneBar } from "./PaneBar";
import type { TopBarProps } from "./types";

/**
 * iOS navigation bar: the system large title (Liquid Glass bar material on
 * iOS 26) with the account button trailing it. Render it inside a screen. In
 * a list-detail pair the native bar would span both panes, so it is hidden and
 * the list pane draws this title and toolbar itself (ListDetail's `bar`).
 */
export function TopBar({
	title,
	accountInitials,
	accountLabel,
	onAccountPress,
}: TopBarProps) {
	const t = useTranslations("mobile.composer");
	const { space } = useTheme();
	const { listDetail } = useLayoutClass();
	const add = useOptionalAddEntry();
	// The iPad has no tab-bar plus (its bar is a top bar that overflows), so
	// the toolbar carries it next to the account button.
	const showAdd = Platform.OS === "ios" && Platform.isPad && add !== null;
	const hasTrailing = showAdd || accountInitials;
	const buttons = () => (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: space[2],
			}}
		>
			{showAdd ? (
				<AddButton
					label={t("addExpense")}
					onPress={() => add?.open("expense")}
				/>
			) : null}
			{accountInitials ? (
				<AccountButton
					initials={accountInitials}
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
				headerLargeTitle: true,
				headerShadowVisible: false,
				headerRight: hasTrailing ? buttons : undefined,
			}}
		/>
	);
}
