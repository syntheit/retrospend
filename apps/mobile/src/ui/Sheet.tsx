import { BottomSheet } from "@expo/ui";
import type { ReactNode } from "react";
import { Platform, Text, View } from "react-native";
import { useTheme } from "@/theme";

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
	return (
		<BottomSheet
			containerColor={color.surface}
			isPresented={visible}
			onDismiss={onClose}
			scrimColor={color.scrim}
			snapPoints={detents?.map((d) => (d === "medium" ? "half" : "full"))}
		>
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
		</BottomSheet>
	);
}
