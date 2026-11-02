import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useTheme } from "@/theme";
import { CollapsingBarProvider } from "@/ui/barScroll";
import { useLayoutClass } from "./useLayoutClass";

/**
 * The stack inside one tab. iOS gets the system large title and its own bar
 * material (Liquid Glass on iOS 26). Android gets the Material 3 top app
 * bar: on a tab root (`collapsing`) the large bar that shrinks as the list
 * scrolls, drawn by TopBar over the screen (ui/CollapsingBar), and a flat
 * small bar with the back arrow on every page pushed over it.
 * `footer` is the height of a row pinned under the large bar (People's tabs).
 */
export function TabStack({
	title,
	collapsing = false,
	footer,
}: {
	title: string;
	collapsing?: boolean;
	footer?: number;
}) {
	const { color } = useTheme();
	// A wide window draws each pane's own bar (ListDetail), not the large one.
	const { listDetail } = useLayoutClass();
	const android = Platform.OS === "android";
	const large = android && collapsing && !listDetail;
	return (
		<Stack
			screenLayout={({ route, children }) =>
				// Only the tab's own list has the large bar; the pages pushed over it
				// keep the plain lists and the system's small bar.
				large && route.name === "index" ? (
					<CollapsingBarProvider footer={footer}>
						{children}
					</CollapsingBarProvider>
				) : (
					children
				)
			}
			screenOptions={{
				// A pushed page names itself; until it does the bar is blank, never the route ("[id]").
				title: "",
				// A page pushed inside the tab has the inline title and the system
				// back button; only the tab's own list has the large one.
				headerLargeTitle: false,
				headerShadowVisible: false,
				headerTintColor: color.fg,
				headerStyle: android ? { backgroundColor: color.bg } : undefined,
				contentStyle: { backgroundColor: color.bg },
			}}
		>
			<Stack.Screen
				name="index"
				options={{
					title,
					headerLargeTitle: !android,
					headerShown: !large,
				}}
			/>
		</Stack>
	);
}
