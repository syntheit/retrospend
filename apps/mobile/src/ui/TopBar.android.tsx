import { Stack } from "expo-router";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { AccountButton } from "./AccountButton";
import { PaneBar } from "./PaneBar";
import type { TopBarProps } from "./types";

/**
 * Android top app bar: flat on the theme background, the title at the start
 * (M3 small top app bar) and the account avatar at the end. In a list-detail
 * pair the list pane draws its own bar (ListDetail's `bar`).
 */
export function TopBar({
	title,
	accountInitials,
	accountLabel,
	onAccountPress,
}: TopBarProps) {
	const { color } = useTheme();
	const { listDetail } = useLayoutClass();
	if (listDetail) {
		return (
			<>
				<Stack.Screen options={{ headerShown: false }} />
				<PaneBar
					title={title}
					trailing={
						accountInitials ? (
							<AccountButton
								initials={accountInitials}
								label={accountLabel ?? title}
								onPress={onAccountPress}
							/>
						) : undefined
					}
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
