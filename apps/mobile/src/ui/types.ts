// Props shared by the platform variants of a UI component. `X.ios.tsx` and
// `X.android.tsx` both import their props from here, so the two can not drift.
// tsc resolves `./X` to the .ios file (tsconfig moduleSuffixes); Metro picks
// the file for the running platform.

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
	/** The signed-in person's initials, for the account button. */
	accountInitials?: string;
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
	onPress?: () => void;
	/**
	 * Filled is the one primary action on a screen; outlined is the rest;
	 * text is a link-like action (Change server).
	 */
	variant?: "filled" | "outlined" | "text";
	disabled?: boolean;
}
