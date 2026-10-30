import { DMSans_400Regular } from "@expo-google-fonts/dm-sans/400Regular";
import { DMSans_500Medium } from "@expo-google-fonts/dm-sans/500Medium";
import { DMSans_600SemiBold } from "@expo-google-fonts/dm-sans/600SemiBold";
import { useFonts } from "expo-font";
import { Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { type ComponentType, useEffect } from "react";
import { useTranslations } from "use-intl";
import { Platform, useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
	ServerConnectionProvider,
	useServerConnection,
} from "@/auth/server-connection";
import { SessionProvider, useSession } from "@/auth/session";
import { pushedHeader, SETTINGS_SCREENS } from "@/layout/pushedHeader";
import { GALLERY_ENABLED } from "@/lib/flags";
import { AppIntlProvider } from "@/lib/intl";
import { MoneyPrefsProvider } from "@/lib/money";
// Defines the Android background poll (a no-op elsewhere); it has to exist
// before the app starts for the system to run it headless.
import "@/push/background";
import { PushProvider } from "@/push/PushProvider";
import { navigationTheme, themeFor, useTheme } from "@/theme";
import { ToastProvider } from "@/ui/Toast";

// Metro folds the inlined env var, so a build without it leaves the dev
// sign-in out of the bundle entirely (scripts/check-release-bundle.sh).
const DevAutoSignIn: ComponentType | null = process.env.EXPO_PUBLIC_DEV_SERVER
	? require("@/dev/DevAutoSignIn").DevAutoSignIn
	: null;

/**
 * Settings and its pages push over the tabs in this stack (the toast and the
 * sheets live in the root view, so it is not a native modal). They are root
 * routes with the system header, so each one has the native back button; the
 * list of sections has the large title on iOS, every page under it an inline
 * title (GUIDELINE 15).
 */
function useSettingsScreens() {
	const t = useTranslations("mobile.settings");
	const { color } = useTheme();
	const android = Platform.OS === "android";
	const header = pushedHeader(color, android);
	return SETTINGS_SCREENS.map((screen) => (
		<Stack.Screen
			key={screen.name}
			name={screen.name}
			options={
				screen.redirect
					? { headerShown: false }
					: {
							...header,
							title: screen.title ? t(screen.title as never) : "",
							headerLargeTitle: screen.large ? !android : false,
						}
			}
		/>
	));
}

function Routes() {
	const { connection } = useServerConnection();
	const { state } = useSession();
	const settingsScreens = useSettingsScreens();
	// The keystore read and the first profile fetch take a moment; the
	// native splash covers it.
	if (connection.status === "loading" || state.status === "loading")
		return null;
	const connected = connection.status === "connected";
	const signedIn = connected && state.status === "signedIn";
	return (
		<Stack screenOptions={{ headerShown: false }}>
			<Stack.Protected guard={signedIn}>
				<Stack.Screen name="(tabs)" />
				{settingsScreens}
			</Stack.Protected>
			<Stack.Protected guard={connected && !signedIn}>
				<Stack.Screen name="sign-in" />
			</Stack.Protected>
			<Stack.Protected guard={!connected}>
				<Stack.Screen name="connect" />
			</Stack.Protected>
			<Stack.Protected guard={GALLERY_ENABLED}>
				<Stack.Screen name="gallery" />
			</Stack.Protected>
		</Stack>
	);
}

export default function RootLayout() {
	const scheme = useColorScheme();
	// DM Sans for every word outside the native chrome (GUIDELINE §2.3), one
	// face per weight token. The files ship in the bundle and load while the
	// native splash shows; on an error the system font stands in.
	const [fontsLoaded, fontError] = useFonts({
		DMSans_400Regular,
		DMSans_500Medium,
		DMSans_600SemiBold,
	});

	// The window behind every screen (seen during rotation and on Android
	// behind transparent system bars) follows the theme.
	useEffect(() => {
		SystemUI.setBackgroundColorAsync(themeFor(scheme).color.bg);
	}, [scheme]);

	if (!fontsLoaded && !fontError) return null;

	return (
		<GestureHandlerRootView style={{ flex: 1 }}>
			<SafeAreaProvider>
				<AppIntlProvider>
					<ThemeProvider value={navigationTheme(scheme)}>
						<ServerConnectionProvider>
							<SessionProvider>
								<MoneyPrefsProvider>
									<PushProvider>
										<ToastProvider>
											<Routes />
											{DevAutoSignIn ? <DevAutoSignIn /> : null}
										</ToastProvider>
									</PushProvider>
								</MoneyPrefsProvider>
							</SessionProvider>
						</ServerConnectionProvider>
						<StatusBar style="auto" />
					</ThemeProvider>
				</AppIntlProvider>
			</SafeAreaProvider>
		</GestureHandlerRootView>
	);
}
