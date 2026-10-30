// Props shared by the platform variants of a UI component. `X.ios.tsx` and
// `X.android.tsx` both import their props from here, so the two can not drift.
// tsc resolves `./X` to the .ios file (tsconfig moduleSuffixes); Metro picks
// the file for the running platform.

import type { ReactElement } from "react";
import type { Face } from "./Avatar";
import type { GlyphName } from "./Glyph";

/** The platform sheet around the content Sheet lays out (SheetFrame). */
export interface SheetFrameProps {
	visible: boolean;
	onClose: () => void;
	detents?: ("medium" | "large")[];
	/** The sheet's own color. */
	background: string;
	/**
	 * Draws the content. `height` is the height the content takes when the
	 * sheet sets it (iOS with detents), or null when the content sizes itself.
	 */
	children: (height: number | null) => ReactElement;
}

export interface MenuItem {
	id: string;
	label: string;
	onPress: () => void;
	destructive?: boolean;
	/**
	 * An identity mark before the label: a face, a bare category glyph or a
	 * cover (GUIDELINE 8), for filter menus of people, categories and
	 * projects. Android draws it in the item's leading slot. The iOS system
	 * menu draws only SF Symbols, so it shows the label alone there.
	 */
	lead?: ReactElement;
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
	/**
	 * A set chip that can be cleared (a set period): while `active`, an x
	 * after the label calls this, in place of the chevron. Needs
	 * `clearLabel`. Chip only.
	 */
	onClear?: () => void;
	/** The spoken name of the clear mark ("Clear period"). */
	clearLabel?: string;
	/**
	 * Draws the chip as the sort mark alone (up and down arrows), a circle the
	 * height of a chip. `accessibilityLabel` is what it is called; it is on
	 * while `active`. Chip only.
	 */
	sortIcon?: boolean;
	/**
	 * A calendar mark before a chip's label (the date chip). Chip only.
	 */
	leadingCalendar?: boolean;
	/**
	 * Draws the trigger as the overflow mark (three dots) alone, 44 points, for
	 * the toolbar. `label` is not shown then, so pass `accessibilityLabel`.
	 */
	icon?: boolean;
	/**
	 * Draws the trigger as a page-level choice (the month on Budget): 16/500
	 * in accent-strong with a chevron, no border.
	 */
	heading?: boolean;
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
	/**
	 * Fills the width it is given, with equal segments. iOS is as wide as its
	 * labels without it; Android always fills.
	 */
	stretch?: boolean;
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
	/** iOS: the long-press menu (Income, Transfer); a tap always adds an expense. Android has none. */
	actions?: AddAction[];
}

/** An icon-only page action in the top bar. */
export interface TopBarAction {
	id: string;
	/** The accessibility label, also the name of the action. */
	label: string;
	icon: GlyphName;
	onPress: () => void;
}

export interface TopBarProps {
	title: string;
	/**
	 * Icon-only page actions (Add person, New project), at the end of the bar
	 * before the overflow menu and the account button.
	 */
	actions?: TopBarAction[];
	/**
	 * The page's overflow menu (the three dots), at the end of the bar before
	 * the account button. Without items there is no mark.
	 */
	overflow?: MenuItem[];
	overflowLabel?: string;
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
	 * of a destructive sheet, placed last; dangerText is the bare danger-text
	 * ghost for a destructive action beside others (Delete on an entry).
	 * Outlined and dangerText are the kit's secondary and ghost looks.
	 */
	variant?: "filled" | "outlined" | "text" | "danger" | "dangerText";
	/**
	 * Small is the 28 point control (an outlined Resume or Use my plan inside a
	 * row or notice), only next to other small controls (R31).
	 */
	size?: "regular" | "small";
	/** A glyph before the label on outlined and dangerText (SwiftUI buttons only). */
	icon?: ButtonIcon;
	/**
	 * Fills the width its row gives it, for two equal halves on a card. The
	 * label stays centered; the height is the control height either way.
	 */
	fill?: boolean;
	disabled?: boolean;
}

/** The glyphs a button may lead with. */
export type ButtonIcon = "Trash2" | "Repeat" | "Pencil" | "Plus";

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
	/** The earliest day that can be picked, "yyyy-MM-dd". */
	minimum?: string;
	/** Today and Yesterday chips under the row, like the web date picker. */
	quick?: boolean;
	/** What Today means with `quick`, when it is not the phone's day. */
	today?: string;
}
