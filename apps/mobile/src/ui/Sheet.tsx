import { type ReactNode, useMemo, useState } from "react";
import { Platform, Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Button } from "./Button";
import { Glyph } from "./Glyph";
import { SheetFrame } from "./SheetFrame";
import {
	fillsSheet,
	footerHeight,
	type PinnedAction,
	SHEET_CHROME,
	SheetContext,
} from "./sheetContext";
import { Text } from "./Text";

/**
 * The size of a full-height body (a scrolling list, the composer) in a sheet
 * with detents. On iOS the sheet gives its content the height of the detent
 * it is at, so the body flexes into the room between the header and the
 * pinned footer. On Android the body takes most of the
 * window (the M3 sheet shows its top at half and the rest when pulled up),
 * leaving room for a pinned footer when the sheet has one (`footer`). On
 * phones the width is the window's less the sheet's side padding.
 */
export function useSheetBodySize(options?: { footer?: boolean }): {
	width?: number;
	height?: number;
	flex?: number;
	minHeight?: number;
} {
	const insets = useSafeAreaInsets();
	const { height, width } = useWindowDimensions();
	const theme = useTheme();
	if (Platform.OS === "ios") {
		return Platform.isPad
			? { flex: 1, minHeight: 0 }
			: { width: width - 2 * theme.space[4], flex: 1, minHeight: 0 };
	}
	const footer = options?.footer ? footerHeight(theme) + theme.space[3] : 0;
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
	/**
	 * A sheet of cards (the composer): the page color, so the surface cards on
	 * it read as cards, the way iOS groups a form. Default: the surface.
	 */
	grouped?: boolean;
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
	grouped = false,
	children,
}: SheetProps) {
	const { color, space } = useTheme();
	const way = dismiss ?? (title ? "close" : "none");
	// A form hands its primary action up (usePinnedAction); the sheet draws it
	// in the footer, under the scrolling body.
	const [pinned, setPinned] = useState<PinnedAction | null>(null);
	const fills = fillsSheet(detents);
	const tallest = !detents
		? null
		: detents.includes("large")
			? ("large" as const)
			: ("medium" as const);
	const context = useMemo(
		() => ({ detent: tallest, fills, pin: setPinned }),
		[tallest, fills],
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
	// Where the sheet sets the content's height (fills), the content is a
	// column that height: the header on top, the body flexing in the middle (a
	// scrolling body scrolls what does not fit), the footer pinned at the
	// bottom. Content that sized itself past its detent would be centered by
	// the system and lose its header and footer.
	const content = (height: number | null) => (
		<View
			style={{
				height: height ?? undefined,
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
			{height !== null ? (
				<View
					style={{ flex: 1, minHeight: 0, gap: space[3], overflow: "hidden" }}
				>
					{children}
				</View>
			) : (
				children
			)}
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
		<SheetFrame
			background={grouped ? color.bg : color.surface}
			detents={detents}
			onClose={onClose}
			visible={visible}
		>
			{(height) => (
				<SheetContext.Provider value={context}>
					{content(height)}
				</SheetContext.Provider>
			)}
		</SheetFrame>
	);
}
