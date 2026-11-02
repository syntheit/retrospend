import { createContext, useContext, useEffect, useRef } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { type Theme, useTheme } from "@/theme";

/** The sheet's handle and header row above a body, plus its padding. */
export const SHEET_CHROME = Platform.OS === "ios" ? 84 : 120;

/** The pinned footer's height: a hairline, its padding and one button row. */
export function footerHeight({ size, space }: Theme): number {
	return 1 + space[3] + size.touchMin.phone;
}

/** How much of the window an Android sheet at full height gives its body. */
const LARGE_FILL = 0.8;
/** A medium detent rests at half the window. */
const MEDIUM_SHARE = 0.5;

/** The space above the content inside an iOS sheet, under the grabber. */
export const SHEET_PAD_TOP = 16;
/** The share of the window the floating iPad sheet takes (always large there). */
const IPAD_SHEET_SHARE = 0.88;
/**
 * What the content leaves free under its iOS detent, so it never runs past
 * the sheet. The content sits at the top of the sheet, so room to spare
 * shows as a little space under the footer, and the footer ends just above
 * the home indicator; content taller than the sheet by more than the top
 * padding would lose its header, so the spare stays small but not zero.
 */
const LARGE_SPARE = 6;
const MEDIUM_SPARE = 4;

/**
 * The text scale above which a sheet always rests at its large detent: the
 * body is taller than a medium sheet has room for, so the person would scroll
 * a half-height window. Matches the cap the chrome text keeps (1.3).
 */
export const BIG_TEXT_SCALE = 1.3;

/**
 * The detents a sheet rests at for the person's text size. At the default
 * size they are the sheet's own; at a big size a sheet with detents has only
 * large, so the body gets the whole window and scrolls above the pinned
 * footer. A sheet that fits its content (no detents) is left as it is.
 */
export function detentsForScale<T extends "medium" | "large">(
	detents: T[] | undefined,
	fontScale: number,
): (T | "large")[] | undefined {
	if (!detents || detents.length === 0 || fontScale <= BIG_TEXT_SCALE) {
		return detents;
	}
	return ["large"];
}

/**
 * Whether the sheet sets its content's height: on iOS, a sheet with detents.
 * The content is a column that height, the header on top, the body flexing in
 * the middle and the footer pinned at the bottom. A sheet that fits its
 * content (no detents) and the Android sheet let the content size itself.
 */
export function fillsSheet(detents: readonly unknown[] | undefined): boolean {
	return Platform.OS === "ios" && detents !== undefined && detents.length > 0;
}

/**
 * The height of an iOS sheet's content at a detent, its top padding
 * included. The system lays the content out pinned to the top of the sheet
 * and centers content taller than the detent the sheet is at, which cuts off
 * the header and the footer; so the content takes the height of the detent
 * the sheet is at now. On a phone large is the window under the status bar
 * and above the home indicator, and medium half the window above the home
 * indicator. The iPad sheet floats at most of the window, whatever the detent.
 */
export function sheetContentHeight(
	detent: "medium" | "large",
	{
		window,
		top,
		bottom,
		pad = false,
	}: { window: number; top: number; bottom: number; pad?: boolean },
): number {
	if (pad) return Math.round(window * IPAD_SHEET_SHARE) - LARGE_SPARE;
	if (detent === "medium") {
		return Math.round(window / 2) - bottom - MEDIUM_SPARE;
	}
	return Math.round(window - top - bottom - LARGE_SPARE);
}

/** The one primary action a form hands to the sheet's pinned footer. */
export interface PinnedAction {
	label: string;
	disabled: boolean;
	/** A request is in flight (Android shows the loading indicator in the button). */
	busy?: boolean;
	onPress: () => void;
}

export interface SheetContextValue {
	/** The tallest height the sheet rests at; null when it fits its content. */
	detent: "medium" | "large" | null;
	/** The content takes the sheet's own height (see fillsSheet). */
	fills?: boolean;
	pin: (action: PinnedAction | null) => void;
}

/** Set by Sheet. Outside a sheet (a test, the gallery) a form draws its own button. */
export const SheetContext = createContext<SheetContextValue | null>(null);

/**
 * Hands the sheet this form's primary action, which it draws in the pinned
 * footer under the scrolling body. Returns true once the sheet has it, so the
 * form leaves its own button out; false outside a sheet.
 */
export function usePinnedAction(action: PinnedAction): boolean {
	const sheet = useContext(SheetContext);
	const pin = sheet?.pin ?? null;
	const press = useRef(action.onPress);
	press.current = action.onPress;
	const { label, disabled, busy } = action;
	useEffect(() => {
		if (!pin) return;
		pin({ label, disabled, busy, onPress: () => press.current() });
		return () => pin(null);
	}, [pin, label, disabled, busy]);
	return pin !== null;
}

/** How a scrolling sheet body sizes itself. */
export interface SheetFill {
	flex?: number;
	minHeight?: number;
	maxHeight?: number;
}

/**
 * How a scrolling sheet body sizes itself so the header, the whole body and
 * the pinned footer all show at the height the sheet rests at.
 *
 * Where the sheet hands its content its own height (iOS with detents), the
 * body flexes into the room between the header and the footer and scrolls
 * what does not fit. A fixed height there is a guess at the detent; when the
 * guess is taller than the sheet, the system centers the content and cuts
 * off the header and the footer (Update balance showed only its keypad).
 *
 * Elsewhere the body takes a fixed height, never more than its detent has
 * room for, so a long list scrolls instead of pushing the footer away: half
 * the window for a medium sheet, most of it for a large one. A sheet with
 * both detents is sized for large, since Android shows the top of it at half
 * and the rest when pulled up.
 */
export function useSheetFill(): SheetFill {
	const sheet = useContext(SheetContext);
	const theme = useTheme();
	const { height } = useWindowDimensions();
	if (sheet?.fills) return { flex: 1, minHeight: 0 };
	const footer = footerHeight(theme) + theme.space[3];
	const room = Math.max(
		0,
		sheet?.detent === "medium"
			? height * MEDIUM_SHARE - SHEET_CHROME - footer
			: height * LARGE_FILL - footer,
	);
	return { minHeight: room, maxHeight: room };
}
