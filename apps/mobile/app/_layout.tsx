import { Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { type ComponentType, useEffect } from "react";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
	ServerConnectionProvider,
	useServerConnection,
} from "@/auth/server-connection";
import { SessionProvider, useSession } from "@/auth/session";
import { GALLERY_ENABLED } from "@/lib/flags";
import { AppIntlProvider } from "@/lib/intl";
import { MoneyPrefsProvider } from "@/lib/money";
// Defines the Android background poll (a no-op elsewhere); it has to exist
// before the app starts for the system to run it headless.
import "@/push/background";
import { PushProvider } from "@/push/PushProvider";
import { navigationTheme, themeFor } from "@/theme";
import { ToastProvider } from "@/ui/Toast";

// Metro folds the inlined env var, so a build without it leaves the dev
// sign-in out of the bundle entirely (scripts/check-release-bundle.sh).
const DevAutoSignIn: ComponentType | null = process.env.EXPO_PUBLIC_DEV_SERVER
	? require("@/dev/DevAutoSignIn").DevAutoSignIn
	: null;

function Routes() {
	const { connection } = useServerConnection();
	const { state } = useSession();
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
				<Stack.Screen name="settings" />
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

	// The window behind every screen (seen during rotation and on Android
	// behind transparent system bars) follows the theme.
	useEffect(() => {
		SystemUI.setBackgroundColorAsync(themeFor(scheme).color.bg);
	}, [scheme]);

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
