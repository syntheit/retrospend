import { Stack } from "expo-router";
import { Platform, View } from "react-native";
import { useTranslations } from "use-intl";
import { useOptionalAddEntry } from "@/features/entry/AddEntryProvider";
import { useTheme } from "@/theme";
import { AccountButton } from "./AccountButton";
import { AddButton } from "./AddButton";
import type { TopBarProps } from "./types";

/**
 * iOS navigation bar: the system large title (Liquid Glass bar material on
 * iOS 26) with the account button trailing it. Render it inside a screen.
 */
export function TopBar({
	title,
	accountInitials,
	accountLabel,
	onAccountPress,
}: TopBarProps) {
	const t = useTranslations("mobile.composer");
	const { space } = useTheme();
	const add = useOptionalAddEntry();
	// The iPad has no tab-bar plus (its bar is a top bar that overflows), so
	// the toolbar carries it next to the account button.
	const showAdd = Platform.OS === "ios" && Platform.isPad && add !== null;
	const hasTrailing = showAdd || accountInitials;
	return (
		<Stack.Screen
			options={{
				title,
				headerLargeTitle: true,
				headerShadowVisible: false,
				headerRight: hasTrailing
					? () => (
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
						)
					: undefined,
			}}
		/>
	);
}
