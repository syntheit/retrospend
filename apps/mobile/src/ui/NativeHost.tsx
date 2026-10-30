import { Host } from "@expo/ui";
import type { ReactNode } from "react";
import { type StyleProp, useColorScheme, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";

/**
 * Hosts Expo UI controls (SwiftUI on iOS, Jetpack Compose on Android). The
 * seed is the brand color (primary buttons are brand, GUIDELINE §2.1), so
 * Compose builds its Material 3 scheme from the tokens and never from the
 * wallpaper (no dynamic color in v1). The seed still tints the containers
 * Compose draws on its own, so a control with a selected or on state gets
 * explicit token colors from m3Colors.
 *
 * By default the host matches its contents: its size in the row comes from
 * the native control, reported after the first native layout and written
 * into the Yoga node. A control that has to be on screen the moment its row
 * is (a switch beside a long sentence) cannot wait for that: pass
 * `matchContents={false}` and give the host a size in `style`.
 */
export function NativeHost({
	children,
	tint,
	style,
	matchContents = true,
}: {
	children: ReactNode;
	/** Another seed than the brand, for a control that should not read as an action (iOS draws its value in it). */
	tint?: string;
	/** The host's place in its row, for a control that must keep its size. */
	style?: StyleProp<ViewStyle>;
	/** False: the host is the size `style` gives it, with no native round trip. */
	matchContents?: boolean;
}) {
	const { color } = useTheme();
	const scheme = useColorScheme();
	return (
		<Host
			colorScheme={scheme === "dark" || scheme === "light" ? scheme : undefined}
			matchContents={matchContents}
			seedColor={tint ?? color.brand}
			style={style}
		>
			{children}
		</Host>
	);
}
