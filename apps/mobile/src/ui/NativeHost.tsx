import { Host } from "@expo/ui";
import type { ReactNode } from "react";
import { useColorScheme } from "react-native";
import { useTheme } from "@/theme";

/**
 * Hosts Expo UI controls (SwiftUI on iOS, Jetpack Compose on Android). The
 * seed is the brand color (primary buttons are brand, GUIDELINE §2.1), so
 * Compose builds its Material 3 scheme from the tokens and never from the
 * wallpaper (no dynamic color in v1).
 */
export function NativeHost({ children }: { children: ReactNode }) {
	const { color } = useTheme();
	const scheme = useColorScheme();
	return (
		<Host
			colorScheme={scheme === "dark" || scheme === "light" ? scheme : undefined}
			matchContents
			seedColor={color.brand}
		>
			{children}
		</Host>
	);
}
