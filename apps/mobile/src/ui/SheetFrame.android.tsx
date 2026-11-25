import { BottomSheet, RNHostView } from "@expo/ui";
import { useState } from "react";
import { Modal, Pressable, useWindowDimensions, View } from "react-native";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { DIALOG_WIDTH, dialogHeight } from "./sheetContext";
import type { SheetFrameProps } from "./types";

/**
 * The M3 modal bottom sheet (back closes it before the screen). The content
 * sizes itself: at half the sheet shows the top of it, and pulled up the
 * rest. Compose hosts React Native views only inside RNHostView; without it
 * they draw but never receive a touch.
 *
 * On a tablet the sheet is a centered form sheet instead, 640 wide over a
 * scrim (the iPad's sheet floats the same way): a plain Modal, closed by back
 * or the sheet's own header, never by a tap on the scrim, so a form with
 * unsaved changes is not lost by a stray touch.
 */
export function SheetFrame({
	visible,
	onClose,
	locked = false,
	detents,
	background,
	children,
}: SheetFrameProps) {
	const { color, radius } = useTheme();
	const { tablet } = useLayoutClass();
	const { height } = useWindowDimensions();
	// A swipe down cannot be switched off through the universal sheet (the
	// Compose sheet's own `sheetGesturesEnabled` is not passed on), and showing
	// a hidden Compose sheet again by flipping `isPresented` does not work (its
	// hide animation settles after the flip). So a locked sheet the system
	// dismissed is mounted anew: a new key, presented from the start.
	const [epoch, setEpoch] = useState(0);
	if (tablet) {
		return (
			<Modal
				animationType="fade"
				onRequestClose={locked ? () => undefined : onClose}
				statusBarTranslucent
				transparent
				visible={visible}
			>
				<Pressable
					accessible={false}
					style={{
						flex: 1,
						alignItems: "center",
						justifyContent: "center",
						backgroundColor: color.scrim,
					}}
				>
					<View
						style={{
							width: DIALOG_WIDTH,
							maxWidth: "100%",
							maxHeight: dialogHeight(height),
							overflow: "hidden",
							borderRadius: radius.panel,
							backgroundColor: background,
						}}
					>
						{children(null)}
					</View>
				</Pressable>
			</Modal>
		);
	}
	return (
		<BottomSheet
			containerColor={background}
			isPresented={visible}
			key={epoch}
			// A locked sheet is not closed: not by back, not by a tap on the scrim,
			// and if a swipe took it down anyway it is mounted again, so the sheet
			// never stays "visible" with nothing on screen.
			onDismiss={locked ? () => setEpoch((n) => n + 1) : onClose}
			shouldDismissOnBackPress={!locked}
			shouldDismissOnClickOutside={!locked}
			scrimColor={color.scrim}
			snapPoints={detents?.map((d) => (d === "medium" ? "half" : "full"))}
		>
			<RNHostView matchContents={{ vertical: true }}>
				{children(null)}
			</RNHostView>
		</BottomSheet>
	);
}
