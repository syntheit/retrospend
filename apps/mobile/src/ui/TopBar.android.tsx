import { Stack } from "expo-router";
import { useTheme } from "@/theme";
import { AccountButton } from "./AccountButton";
import type { TopBarProps } from "./types";

/**
 * Android top app bar: flat on the theme background, the title at the start
 * (M3 small top app bar) and the account avatar at the end.
 */
export function TopBar({
	title,
	accountInitials,
	accountLabel,
	onAccountPress,
}: TopBarProps) {
	const { color } = useTheme();
	return (
		<Stack.Screen
			options={{
				title,
				headerLargeTitle: false,
				headerShadowVisible: false,
				headerStyle: { backgroundColor: color.bg },
				headerTintColor: color.fg,
				headerRight: accountInitials
					? () => (
							<AccountButton
								initials={accountInitials}
								label={accountLabel ?? title}
								onPress={onAccountPress}
							/>
						)
					: undefined,
			}}
		/>
	);
}
