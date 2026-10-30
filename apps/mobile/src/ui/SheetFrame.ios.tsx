import { BottomSheet, Group, Host, RNHostView } from "@expo/ui/swift-ui";
import {
	frame,
	padding,
	presentationBackground,
	presentationDetents,
	presentationDragIndicator,
} from "@expo/ui/swift-ui/modifiers";
import { useEffect, useState } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";
import { SHEET_PAD_TOP, sheetContentHeight } from "./sheetContext";
import type { SheetFrameProps } from "./types";

/**
 * The SwiftUI sheet. It follows the detent the sheet is at (the person drags
 * between them) and gives the content that detent's height, pinned to the
 * top. Content taller than its detent would be centered by the system and
 * lose its header and footer, so the content is never left to size itself
 * when the sheet has detents. Without detents the sheet fits its content.
 * The iPad sheet floats at one height: its medium is half of a sheet sized
 * from the content, too short for a form, so an iPad sheet is always large.
 */
export function SheetFrame({
	visible,
	onClose,
	detents,
	background,
	children,
}: SheetFrameProps) {
	const { space } = useTheme();
	const insets = useSafeAreaInsets();
	const { height } = useWindowDimensions();
	const pad = Platform.OS === "ios" && Platform.isPad;
	const shown: ("medium" | "large")[] | undefined =
		detents?.length && pad ? ["large"] : detents;
	const rest = shown?.includes("medium") ? "medium" : "large";
	const [at, setAt] = useState<"medium" | "large">(rest);
	// Each opening starts at the detent the sheet rests at.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `visible` is the trigger
	useEffect(() => {
		if (visible) setAt(rest);
	}, [visible]);
	const now = shown?.includes(at) ? at : rest;
	const content = shown?.length
		? sheetContentHeight(now, {
				window: height,
				top: insets.top,
				bottom: insets.bottom,
				pad,
			})
		: null;
	return (
		<Host pointerEvents="none" style={{ position: "absolute" }}>
			<BottomSheet
				fitToContents={!shown?.length}
				isPresented={visible}
				onIsPresentedChange={(presented) => {
					if (!presented) onClose();
				}}
			>
				<Group
					modifiers={[
						frame({
							maxWidth: Number.POSITIVE_INFINITY,
							maxHeight:
								content === null ? undefined : Number.POSITIVE_INFINITY,
							alignment: "topLeading",
						}),
						padding({
							top: SHEET_PAD_TOP,
							leading: space[4],
							trailing: space[4],
							bottom: 0,
						}),
						presentationDragIndicator("visible"),
						...(shown?.length
							? [
									presentationDetents(shown, {
										selection: now,
										onSelectionChange: (d) =>
											setAt(d === "medium" ? "medium" : "large"),
									}),
								]
							: []),
						presentationBackground(background),
					]}
				>
					<RNHostView matchContents={{ vertical: true }}>
						{children(content === null ? null : content - SHEET_PAD_TOP)}
					</RNHostView>
				</Group>
			</BottomSheet>
		</Host>
	);
}
