import { Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
	ServerConnectionProvider,
	useServerConnection,
} from "@/auth/server-connection";
import { SessionProvider, useSession } from "@/auth/session";
import { DevAutoSignIn } from "@/dev/DevAutoSignIn";
import { GALLERY_ENABLED } from "@/lib/flags";
import { AppIntlProvider } from "@/lib/intl";
import { installNumberFormatToParts } from "@/lib/intl-polyfill";
import { navigationTheme, themeFor } from "@/theme";
import { ToastProvider } from "@/ui/Toast";

// Before any money is formatted: Hermes on iOS has no formatToParts.
installNumberFormatToParts();

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
								<ToastProvider>
									<DevAutoSignIn />
									<Routes />
								</ToastProvider>
							</SessionProvider>
						</ServerConnectionProvider>
						<StatusBar style="auto" />
					</ThemeProvider>
				</AppIntlProvider>
			</SafeAreaProvider>
		</GestureHandlerRootView>
	);
}
