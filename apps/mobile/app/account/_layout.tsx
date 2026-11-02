import { Stack } from "expo-router";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { pushedHeader } from "@/layout/pushedHeader";
import { useSettingsScreens } from "@/layout/useSettingsScreens";
import { useTheme } from "@/theme";
import { LAYER } from "@/ui/metrics";
import { ToastProvider } from "@/ui/Toast";

// The sheet opens at its first page; a link to a page inside it still has
// that page under it, so Back returns to the account sheet.
export const unstable_settings = { anchor: "index" };

/**
 * The Material 3 drag handle: 32 by 4 dp in a 24 dp band at the sheet's top
 * (Android only; iOS draws its own grabber).
 */
function DragHandle() {
	const { color, space, radius } = useTheme();
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				height: space[6],
				// Above the stack, which moves up under it (see AccountLayout).
				zIndex: LAYER.above,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<View
				style={{
					width: space[8],
					height: space[1],
					borderRadius: radius.chip,
					backgroundColor: color.lineStrong,
				}}
			/>
		</View>
	);
}

/**
 * The account sheet's stack. The toast lives in the root view, which the
 * native sheet covers, so the sheet carries one of its own (an Undo after a
 * change made in a page shows above that page). On Android the sheet is a
 * Material 3 modal bottom sheet: the drag handle on top, then the bar.
 */
export default function AccountLayout() {
	const t = useTranslations("mobile.account");
	const { color } = useTheme();
	const android = Platform.OS === "android";
	const screens = useSettingsScreens("account");
	// The bar pads itself by the status bar, but the sheet sits below it, so
	// the stack moves up by that much to put the bar right under the handle.
	const inset = useSafeAreaInsets().top;
	return (
		<ToastProvider>
			{android ? <DragHandle /> : null}
			<View style={{ flex: 1, marginTop: android ? -inset : 0 }}>
				<Stack screenOptions={{ ...pushedHeader(color, android), title: "" }}>
					<Stack.Screen
						name="index"
						options={{
							title: t("title"),
							// The sheet's first page has nothing to go back to: the sheet
							// closes by swipe, scrim or system back, so no arrow here.
							headerBackVisible: !android,
						}}
					/>
					{screens}
				</Stack>
			</View>
		</ToastProvider>
	);
}
