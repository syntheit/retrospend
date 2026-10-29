import { createContext, useContext, useEffect, useRef } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { type Theme, useTheme } from "@/theme";

/** The sheet's handle and header row above a body, plus its padding. */
export const SHEET_CHROME = Platform.OS === "ios" ? 84 : 120;

/** The pinned footer's height: a hairline, its padding and one button row. */
export function footerHeight({ size, space }: Theme): number {
	return 1 + space[3] + size.touchMin.phone;
}

/** How much of the window a large sheet body claims: enough to pin the top, short of the status bar. */
const LARGE_FILL = 0.8;
/** A medium detent rests at half the window. */
const MEDIUM_SHARE = 0.5;

/** The one primary action a form hands to the sheet's pinned footer. */
export interface PinnedAction {
	label: string;
	disabled: boolean;
	onPress: () => void;
}

export interface SheetContextValue {
	/** The tallest height the sheet rests at; null when it fits its content. */
	detent: "medium" | "large" | null;
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
	const { label, disabled } = action;
	useEffect(() => {
		if (!pin) return;
		pin({ label, disabled, onPress: () => press.current() });
		return () => pin(null);
	}, [pin, label, disabled]);
	return pin !== null;
}

/**
 * The height a scrolling sheet body claims so its content starts at the top
 * (the platform sheet centers short content in its detent). A large sheet
 * takes most of the window; a medium one takes what is left of half the
 * window under the header and above the pinned footer, so it rests at medium.
 */
export function useSheetFill(): { minHeight: number; maxHeight?: number } {
	const sheet = useContext(SheetContext);
	const theme = useTheme();
	const { height } = useWindowDimensions();
	const footer = footerHeight(theme) + theme.space[3];
	if (sheet?.detent === "medium") {
		const room = Math.max(0, height * MEDIUM_SHARE - SHEET_CHROME - footer);
		return { minHeight: room, maxHeight: room };
	}
	return { minHeight: Math.max(0, height * LARGE_FILL - footer) };
}
