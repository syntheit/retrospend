import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useTranslations } from "use-intl";
import { pushedHeader } from "@/layout/pushedHeader";
import { useSettingsScreens } from "@/layout/useSettingsScreens";
import { useTheme } from "@/theme";
import { ToastProvider } from "@/ui/Toast";

// The sheet opens at its first page; a link to a page inside it still has
// that page under it, so Back returns to the account sheet.
export const unstable_settings = { anchor: "index" };

/**
 * The account sheet's stack. The toast lives in the root view, which the
 * native sheet covers, so the sheet carries one of its own (an Undo after a
 * change made in a page shows above that page).
 */
export default function AccountLayout() {
	const t = useTranslations("mobile.account");
	const { color } = useTheme();
	const android = Platform.OS === "android";
	const screens = useSettingsScreens("account");
	return (
		<ToastProvider>
			<Stack screenOptions={{ ...pushedHeader(color, android), title: "" }}>
				<Stack.Screen name="index" options={{ title: t("title") }} />
				{screens}
			</Stack>
		</ToastProvider>
	);
}
