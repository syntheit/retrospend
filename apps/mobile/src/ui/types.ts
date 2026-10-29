// Props shared by the platform variants of a UI component. `X.ios.tsx` and
// `X.android.tsx` both import their props from here, so the two can not drift.
// tsc resolves `./X` to the .ios file (tsconfig moduleSuffixes); Metro picks
// the file for the running platform.

import type { Face } from "./Avatar";

export interface MenuItem {
	id: string;
	label: string;
	onPress: () => void;
	destructive?: boolean;
}

export interface MenuProps {
	/** The trigger's text, also its accessibility label. */
	label: string;
	/** What a screen reader says when it differs from the text ("Currency, ARS"). */
	accessibilityLabel?: string;
	items: MenuItem[];
	/**
	 * Draws the trigger as a filter chip with a chevron (Activity and Insights
	 * filters) instead of a text button.
	 */
	chip?: boolean;
	/** A chip whose filter has a value set: brand-soft with a brand border. */
	active?: boolean;
}

export interface SegmentedOption<T extends string> {
	value: T;
	label: string;
}

export interface SegmentedProps<T extends string> {
	options: SegmentedOption<T>[];
	value: T;
	onChange: (value: T) => void;
	accessibilityLabel: string;
}

export interface AddAction {
	id: string;
	label: string;
	onPress: () => void;
}

export interface AddButtonProps {
	/** The main action, for example "Add expense". */
	label: string;
	onPress: () => void;
	/** Android: shrinks to the plus when the list scrolls. */
	expanded?: boolean;
	/** Android: the M3 FAB menu (Income, Transfer). iOS: long press. */
	actions?: AddAction[];
}

export interface TopBarProps {
	title: string;
	/** The signed-in person, for the account button: their picture, else initials. */
	account?: Face;
	accountLabel?: string;
	onAccountPress?: () => void;
}

export interface RowMenuProps {
	title?: string;
	items: MenuItem[];
	/** A tap on the row. */
	onPress?: () => void;
	children: React.ReactNode;
}

export interface ButtonProps {
	label: string;
	/** What a screen reader says when it differs from the text ("Currency, ARS"). */
	accessibilityLabel?: string;
	onPress?: () => void;
	/**
	 * Filled is the one primary action on a screen; outlined is the rest;
	 * text is a link-like action (Change server); danger is only the confirm
	 * of a destructive sheet, placed last.
	 */
	variant?: "filled" | "outlined" | "text" | "danger";
	/**
	 * Small is the 28 point control (an outlined Resume or Use my plan inside a
	 * row or notice), only next to other small controls (R31).
	 */
	size?: "regular" | "small";
	disabled?: boolean;
}

/** A settings picker row's menu: its options, the current one, and the change. */
export interface FormMenuProps<T extends string> {
	options: { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
}

export interface DateFieldProps {
	label: string;
	/** A calendar day, "yyyy-MM-dd"; empty while none is picked. */
	value: string;
	onChange: (day: string) => void;
	/** What shows while no day is picked. */
	placeholder?: string;
}
