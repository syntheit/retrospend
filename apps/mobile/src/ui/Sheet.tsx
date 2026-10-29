import { BottomSheet, RNHostView } from "@expo/ui";
import { type ReactNode, useMemo, useState } from "react";
import { Platform, Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Button } from "./Button";
import { Glyph } from "./Glyph";
import {
	footerHeight,
	type PinnedAction,
	SHEET_CHROME,
	SheetContext,
} from "./sheetContext";
import { Text } from "./Text";

/** The share of the screen the iPad form sheet takes. */
const IPAD_SHEET_SHARE = 0.88;

/**
 * The size a full-height body (a scrolling list, the composer) gives itself in
 * a large sheet. The sheet hands its content the window's width without side
 * padding, and on phones runs under the status and gesture bars. A sheet with
 * a pinned footer passes `footer` so the body leaves room for it.
 */
export function useSheetBodySize(options?: { footer?: boolean }): {
	width?: number;
	height: number;
} {
	const insets = useSafeAreaInsets();
	const { height, width } = useWindowDimensions();
	const theme = useTheme();
	const footer = options?.footer ? footerHeight(theme) + theme.space[3] : 0;
	if (Platform.OS === "ios" && Platform.isPad) {
		return { height: Math.round(height * IPAD_SHEET_SHARE) - footer };
	}
	return {
		width: width - 2 * theme.space[4],
		height: Math.round(
			height - insets.top - insets.bottom - SHEET_CHROME - footer,
		),
	};
}

export type SheetDetent = "medium" | "large";

/**
 * The header's way out: an X labeled Close (a task you can walk away from), a
 * Done text button (a sheet whose choices apply as you make them), or none
 * when the sheet draws its own header (the composer).
 */
export type SheetDismiss = "close" | "done" | "none";

interface SheetProps {
	visible: boolean;
	onClose: () => void;
	title?: string;
	/**
	 * Heights the sheet rests at, chosen per sheet: medium for a short task
	 * (a confirm, one amount), large for a list or a long form, both for a
	 * picker. Without it the sheet fits its content.
	 */
	detents?: SheetDetent[];
	/** Default: close when the sheet has a title. */
	dismiss?: SheetDismiss;
	/**
	 * Pinned under the body, right aligned: the secondary action, then the
	 * verb (Cancel, Save). Pass ui/Button elements.
	 */
	footer?: ReactNode;
	children: ReactNode;
}

/** The header's dismiss item, 28 high with a hit slop to the 44 point target. */
function DismissItem({
	kind,
	onPress,
}: {
	kind: Exclude<SheetDismiss, "none">;
	onPress: () => void;
}) {
	const t = useTranslations("mobile.common");
	const { color, size, space } = useTheme();
	const label = kind === "done" ? t("done") : t("close");
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityRole="button"
			hitSlop={space[2]}
			onPress={onPress}
			style={({ pressed }) => ({
				minWidth: size.ctlSm.phone,
				height: size.ctlSm.phone,
				paddingHorizontal: kind === "done" ? space[2] : 0,
				alignItems: "center",
				justifyContent: "center",
				borderRadius: size.ctlSm.phone / 2,
				backgroundColor:
					kind === "close" || pressed ? color.raised : "transparent",
			})}
		>
			{kind === "done" ? (
				<Text style={{ color: color.brand }} weight="semibold">
					{label}
				</Text>
			) : (
				<Glyph color={color.fg2} name="X" size={size.icon.phone} />
			)}
		</Pressable>
	);
}

/**
 * The platform sheet: a SwiftUI sheet with detents on iOS (glass at partial
 * detents comes from the system), an M3 modal bottom sheet on Android (back
 * closes it before the screen). The content is ordinary React Native views:
 * a header (the title in the section style and the dismiss item), the body,
 * and an optional pinned footer above a hairline (GUIDELINE 10).
 */
export function Sheet({
	visible,
	onClose,
	title,
	detents,
	dismiss,
	footer,
	children,
}: SheetProps) {
	const { color, space } = useTheme();
	const way = dismiss ?? (title ? "close" : "none");
	// A form hands its primary action up (usePinnedAction); the sheet draws it
	// in the footer, under the scrolling body.
	const [pinned, setPinned] = useState<PinnedAction | null>(null);
	const context = useMemo(
		() => ({
			detent: !detents
				? null
				: detents.includes("large")
					? ("large" as const)
					: ("medium" as const),
			pin: setPinned,
		}),
		[detents],
	);
	const bottom =
		footer ??
		(pinned ? (
			<Button
				disabled={pinned.disabled}
				label={pinned.label}
				onPress={pinned.onPress}
			/>
		) : null);
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
			{title || way !== "none" ? (
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
				>
					<Text
						accessibilityRole="header"
						numberOfLines={1}
						style={{ flex: 1 }}
						variant="section"
					>
						{title ?? ""}
					</Text>
					{way === "none" ? null : <DismissItem kind={way} onPress={onClose} />}
				</View>
			) : null}
			{children}
			{bottom ? (
				<View
					style={{
						flexDirection: "row",
						justifyContent: "flex-end",
						alignItems: "center",
						gap: space[2],
						paddingTop: space[3],
						borderTopWidth: 1,
						borderTopColor: color.line,
					}}
				>
					{bottom}
				</View>
			) : null}
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
			<RNHostView matchContents={{ vertical: true }}>
				<SheetContext.Provider value={context}>{content}</SheetContext.Provider>
			</RNHostView>
		</BottomSheet>
	);
}
