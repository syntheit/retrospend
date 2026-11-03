// Props shared by the platform variants of a UI component. `X.ios.tsx` and
// `X.android.tsx` both import their props from here, so the two can not drift.
// tsc resolves `./X` to the .ios file (tsconfig moduleSuffixes); Metro picks
// the file for the running platform.

import type { ReactElement } from "react";
import type { Face } from "./Avatar";
import type { GlyphName } from "./Glyph";
import type { MenuIcon } from "./menuIcons";

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
	 * A glyph before the label: the action's own mark (repeat, trash). The iOS
	 * system menu draws its SF Symbol, Android the lucide glyph. Identity marks
	 * (faces, categories) use `lead` instead.
	 */
	icon?: MenuIcon;
	/**
	 * An identity mark before the label: a face, a bare category glyph or a
	 * cover (GUIDELINE 8), for filter menus of people, categories and
	 * projects. Android draws it in the item's leading slot. The iOS system
	 * menu draws only SF Symbols, so it shows the label alone there.
	 */
	lead?: ReactElement;
	/**
	 * Marks the active choice of a list of options (the sort modes): iOS draws
	 * the system menu's checked state, Android a check after the label. Leave
	 * it unset on a menu of actions.
	 */
	selected?: boolean;
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
	 * With `icon`: the mark sits in a raised 28 point circle inside the 44
	 * point touch target, the way a sheet header draws its pencil and close.
	 */
	raised?: boolean;
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
	/** iOS: draw the label beside the plus (the iPad toolbar's "Add" pill). */
	showLabel?: boolean;
	/** iOS: the long-press menu (Income, Transfer); a tap always adds an expense. Android has none (its FAB is the plus, with a long-press tooltip). */
	actions?: AddAction[];
}

/** An icon-only page action in the top bar. */
export interface TopBarAction {
	id: string;
	/** The accessibility label, also the name of the action. */
	label: string;
	icon: GlyphName;
	onPress: () => void;
	/** A count shown on the glyph (unread notifications); none when 0 or absent. */
	badge?: number;
	/**
	 * Android's collapsing bar: the icon appears only once the bar has
	 * collapsed (search, while a search bar sits on the page). Ignored
	 * elsewhere.
	 */
	revealOnCollapse?: boolean;
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
	/**
	 * Android's collapsing bar: a row pinned under the bar that rides with it
	 * (People's tabs). Its height is the one the tab stack gave the provider
	 * (TabStack `footer`). Ignored elsewhere.
	 */
	footer?: ReactElement;
}

export interface RowMenuProps {
	title?: string;
	items: MenuItem[];
	/** A tap on the row. */
	onPress?: () => void;
	/** What a screen reader says for the row, when its content is not the label. */
	accessibilityLabel?: string;
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
	/**
	 * Android: a request is in flight. The button keeps its colors (no
	 * disabled wash), ignores taps and shows the loading indicator before its
	 * label. iOS ignores it (its label already says "Saving").
	 */
	busy?: boolean;
}

/** The Material 3 Expressive loading indicator (Android; iOS draws nothing). */
export interface LoadingIndicatorProps {
	/** Side in points; the Material default is 48. */
	size?: number;
	/** The shape in a round container (a wait on its own) instead of bare. */
	contained?: boolean;
	/** The shape's color; defaults to fg-2, the neutral (it has no color job). */
	color?: string;
	/** What a screen reader says; defaults to "Loading". */
	accessibilityLabel?: string;
}

/** The glyphs a button may lead with. */
export type ButtonIcon =
	| "Trash2"
	| "Repeat"
	| "Pencil"
	| "Plus"
	| "Banknote"
	| "Bell";

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
