import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { pushedHeader, SETTINGS_SCREENS } from "./pushedHeader";

/**
 * The screens of Settings and its pages as stack screens with the system
 * header: each has the native back button; the list of sections has the large
 * title on iOS, every page under it an inline title (GUIDELINE 15). Used by
 * the root stack (`settings/...`, pushed over the tabs) and by the account
 * sheet's own stack (`account/...`); `scope` is the folder the routes live in.
 * The sheet leaves out what it never opens (the Recurring redirect).
 */
export function useSettingsScreens(scope: "settings" | "account") {
	const t = useTranslations("mobile.settings");
	const ta = useTranslations("mobile.admin");
	const { color } = useTheme();
	const android = Platform.OS === "android";
	const header = pushedHeader(color, android);
	const inSheet = scope === "account";
	return SETTINGS_SCREENS.filter(
		(screen) => !inSheet || screen.name !== "settings/recurring",
	).map((screen) => (
		<Stack.Screen
			key={screen.name}
			name={routeName(screen.name, scope)}
			options={
				screen.redirect
					? { headerShown: false }
					: {
							...header,
							title: screen.title
								? (screen.ns === "admin" ? ta : t)(screen.title as never)
								: "",
							headerLargeTitle: screen.large ? !android : false,
						}
			}
		/>
	));
}

/** The route name of a settings screen in its folder: the sheet calls the list `settings`. */
export function routeName(name: string, scope: "settings" | "account"): string {
	if (scope === "settings") return name;
	const page = name.replace(/^settings\//, "");
	return page === "index" ? "settings" : page;
}
