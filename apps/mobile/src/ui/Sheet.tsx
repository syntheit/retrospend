import { BottomSheet, RNHostView } from "@expo/ui";
import type { ReactNode } from "react";
import { Platform, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";

/** The sheet's handle and title above a body, plus its padding. */
const SHEET_CHROME = Platform.OS === "ios" ? 76 : 112;
/** The share of the screen the iPad form sheet takes. */
const IPAD_SHEET_SHARE = 0.88;

/**
 * The size a full-height body (a scrolling list, the composer) gives itself in
 * a large sheet. The sheet hands its content the window's width without side
 * padding, and on phones runs under the status and gesture bars.
 */
export function useSheetBodySize(): { width?: number; height: number } {
	const insets = useSafeAreaInsets();
	const { height, width } = useWindowDimensions();
	const { space } = useTheme();
	if (Platform.OS === "ios" && Platform.isPad) {
		return { height: Math.round(height * IPAD_SHEET_SHARE) };
	}
	return {
		width: width - 2 * space[4],
		height: Math.round(height - insets.top - insets.bottom - SHEET_CHROME),
	};
}

export type SheetDetent = "medium" | "large";

interface SheetProps {
	visible: boolean;
	onClose: () => void;
	title?: string;
	/** Heights the sheet rests at. Without it the sheet fits its content. */
	detents?: SheetDetent[];
	children: ReactNode;
}

/**
 * The platform sheet: a SwiftUI sheet with detents on iOS (glass at partial
 * detents comes from the system), an M3 modal bottom sheet on Android (back
 * closes it before the screen). The content is ordinary React Native views.
 */
export function Sheet({
	visible,
	onClose,
	title,
	detents,
	children,
}: SheetProps) {
	const { color, space, type } = useTheme();
	// Compose hosts React Native views only inside RNHostView; without it they
	// draw but never receive a touch.
	const content = (
		<View
			style={{
				alignSelf: "stretch",
				gap: space[3],
				paddingBottom: Platform.OS === "android" ? space[6] : space[4],
			}}
		>
			{title ? (
				<Text
					accessibilityRole="header"
					style={{
						color: color.fg,
						fontSize: type.section.size,
						fontWeight: "600",
					}}
				>
					{title}
				</Text>
			) : null}
			{children}
		</View>
	);
	return (
		<BottomSheet
			containerColor={color.surface}
			isPresented={visible}
			onDismiss={onClose}
			scrimColor={color.scrim}
			snapPoints={detents?.map((d) => (d === "medium" ? "half" : "full"))}
		>
			<RNHostView matchContents={{ vertical: true }}>{content}</RNHostView>
		</BottomSheet>
	);
}
