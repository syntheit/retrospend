import { Stack } from "expo-router";
import { AccountButton } from "./AccountButton";
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
	return (
		<Stack.Screen
			options={{
				title,
				headerLargeTitle: true,
				headerShadowVisible: false,
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
