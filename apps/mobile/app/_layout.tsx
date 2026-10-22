import { Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
	ServerConnectionProvider,
	useServerConnection,
} from "@/auth/server-connection";
import { AppIntlProvider } from "@/lib/intl";
import { navigationTheme, themeFor } from "@/theme";

function Routes() {
	const { connection } = useServerConnection();
	// The keystore read takes a moment; the native splash covers it.
	if (connection.status === "loading") return null;
	const connected = connection.status === "connected";
	return (
		<Stack screenOptions={{ headerShown: false }}>
			<Stack.Protected guard={connected}>
				<Stack.Screen name="(tabs)" />
			</Stack.Protected>
			<Stack.Protected guard={!connected}>
				<Stack.Screen name="connect" />
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
		<SafeAreaProvider>
			<AppIntlProvider>
				<ThemeProvider value={navigationTheme(scheme)}>
					<ServerConnectionProvider>
						<Routes />
					</ServerConnectionProvider>
					<StatusBar style="auto" />
				</ThemeProvider>
			</AppIntlProvider>
		</SafeAreaProvider>
	);
}
