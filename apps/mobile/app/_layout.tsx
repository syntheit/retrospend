import { DMSans_400Regular } from "@expo-google-fonts/dm-sans/400Regular";
import { DMSans_500Medium } from "@expo-google-fonts/dm-sans/500Medium";
import { DMSans_600SemiBold } from "@expo-google-fonts/dm-sans/600SemiBold";
import { useFonts } from "expo-font";
import { Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { type ComponentType, useEffect } from "react";
import { Platform, useColorScheme, useWindowDimensions } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
	SafeAreaProvider,
	useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import {
	ServerConnectionProvider,
	useServerConnection,
} from "@/auth/server-connection";
import { SessionProvider, useSession } from "@/auth/session";
import { ErrorReportsFlusher } from "@/features/feedback/ErrorReportsFlusher";
import { FeedbackProvider } from "@/features/feedback/FeedbackProvider";
import { installErrorHandlers } from "@/features/feedback/handlers";
import { getErrorLog } from "@/features/feedback/runtime";
import { ScreenTracker } from "@/features/feedback/ScreenTracker";
import { usePredictiveBack } from "@/layout/predictiveBack";
import { accountSheetOptions, tabsScreenOptions } from "@/layout/pushedHeader";
import { useSettingsScreens } from "@/layout/useSettingsScreens";
import { GALLERY_ENABLED } from "@/lib/flags";
import { AppIntlProvider } from "@/lib/intl";
import { MoneyPrefsProvider } from "@/lib/money";
import { holdSplash, releaseSplash, SPLASH_CAP_MS } from "@/lib/splash";
// Defines the Android background poll (a no-op elsewhere); it has to exist
// before the app starts for the system to run it headless.
import "@/push/background";
import { PushProvider } from "@/push/PushProvider";
import { navigationTheme, themeFor, useTheme } from "@/theme";
import { AlertHost } from "@/ui/alert";
import { FontScaleProvider } from "@/ui/fontScale";
import { ToastProvider } from "@/ui/Toast";

// Metro folds the inlined env var, so a build without it leaves the dev
// sign-in out of the bundle entirely (scripts/check-release-bundle.sh).
const DevAutoSignIn: ComponentType | null = process.env.EXPO_PUBLIC_DEV_SERVER
	? require("@/dev/DevAutoSignIn").DevAutoSignIn
	: null;

// The same for the test-only sign-in link, in the e2e build profile only.
const E2eLink: ComponentType | null =
	process.env.EXPO_PUBLIC_E2E === "1" ? require("@/dev/E2eLink").E2eLink : null;

// Records crashes and unhandled promise rejections into the local ring. Nothing
// leaves the phone unless the person turns on error reports (Settings).
installErrorHandlers(getErrorLog());

// The splash stays until the first real screen is ready (Routes), or the cap.
holdSplash();

function Routes() {
	const { connection } = useServerConnection();
	const { state } = useSession();
	const settingsScreens = useSettingsScreens("settings");
	const back = useTranslations("mobile.common")("back");
	usePredictiveBack();
	const windowHeight = useWindowDimensions().height;
	const topInset = useSafeAreaInsets().top;
	const { color } = useTheme();
	// The keystore reads take a moment; the native splash covers it.
	const loading = connection.status === "loading" || state.status === "loading";
	useEffect(() => {
		if (!loading) releaseSplash();
	}, [loading]);
	if (loading) return null;
	const connected = connection.status === "connected";
	const signedIn = connected && state.status === "signedIn";
	return (
		<>
			<ScreenTracker />
			<Stack screenOptions={{ headerShown: false }}>
				<Stack.Protected guard={signedIn}>
					<Stack.Screen name="(tabs)" options={tabsScreenOptions(back)} />
					{settingsScreens}
					<Stack.Screen
						name="account"
						options={accountSheetOptions(
							windowHeight,
							topInset,
							Platform.OS === "android",
							color.bg,
						)}
					/>
				</Stack.Protected>
				<Stack.Protected guard={connected && !signedIn}>
					<Stack.Screen name="sign-in" />
				</Stack.Protected>
				<Stack.Protected guard={!connected}>
					<Stack.Screen name="connect" />
				</Stack.Protected>
				{/* A project you have no seat in, reached by a link: guests have no account. */}
				<Stack.Screen name="shared/[id]" />
				<Stack.Protected guard={GALLERY_ENABLED}>
					<Stack.Screen name="gallery" />
				</Stack.Protected>
			</Stack>
		</>
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

	// A stuck font or keystore never keeps the splash up for good.
	useEffect(() => {
		const timer = setTimeout(releaseSplash, SPLASH_CAP_MS);
		return () => clearTimeout(timer);
	}, []);

	if (!fontsLoaded && !fontError) return null;

	return (
		<GestureHandlerRootView style={{ flex: 1 }}>
			<FontScaleProvider>
				<SafeAreaProvider>
					<AppIntlProvider>
						<ThemeProvider value={navigationTheme(scheme)}>
							<ServerConnectionProvider>
								<SessionProvider>
									<MoneyPrefsProvider>
										<PushProvider>
											<ToastProvider>
												<FeedbackProvider>
													<Routes />
													<ErrorReportsFlusher />
													<AlertHost />
													{DevAutoSignIn ? <DevAutoSignIn /> : null}
													{E2eLink ? <E2eLink /> : null}
												</FeedbackProvider>
											</ToastProvider>
										</PushProvider>
									</MoneyPrefsProvider>
								</SessionProvider>
							</ServerConnectionProvider>
							<StatusBar style="auto" />
						</ThemeProvider>
					</AppIntlProvider>
				</SafeAreaProvider>
			</FontScaleProvider>
		</GestureHandlerRootView>
	);
}
