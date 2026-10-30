import { BottomSheet, RNHostView } from "@expo/ui";
import { useTheme } from "@/theme";
import type { SheetFrameProps } from "./types";

/**
 * The M3 modal bottom sheet (back closes it before the screen). The content
 * sizes itself: at half the sheet shows the top of it, and pulled up the
 * rest. Compose hosts React Native views only inside RNHostView; without it
 * they draw but never receive a touch.
 */
export function SheetFrame({
	visible,
	onClose,
	detents,
	background,
	children,
}: SheetFrameProps) {
	const { color } = useTheme();
	return (
		<BottomSheet
			containerColor={background}
			isPresented={visible}
			onDismiss={onClose}
			scrimColor={color.scrim}
			snapPoints={detents?.map((d) => (d === "medium" ? "half" : "full"))}
		>
			<RNHostView matchContents={{ vertical: true }}>
				{children(null)}
			</RNHostView>
		</BottomSheet>
	);
}
