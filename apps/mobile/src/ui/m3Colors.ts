import type {
	DatePickerElementColors,
	SegmentedButtonColors,
	SwitchColors,
	TextFieldColors,
} from "@expo/ui/jetpack-compose";
import type { Theme } from "@/theme";

/**
 * Container colors for the Material 3 controls, taken from the tokens.
 *
 * The Compose scheme is generated from the brand seed, which makes tonal
 * peach and pink fills that are not tokens. A control that draws a container
 * (the selected segment, the switch track) is given explicit token colors
 * instead, so light and dark read as the rest of the app does (GUIDELINE
 * §2.1: brand marks selection; raised is the quiet fill).
 *
 * Still on the seed, because no existing token fits the slot: the disabled
 * states (M3 draws them as a wash of the on-surface color) and the ripple.
 */
type ThemeColor = Theme["color"];

/** The single-choice segment: brand-soft when selected, raised when not. */
export function segmentedColors(color: ThemeColor): SegmentedButtonColors {
	return {
		activeContainerColor: color.brandSoft,
		activeContentColor: color.fg,
		activeBorderColor: color.brand,
		inactiveContainerColor: color.raised,
		inactiveContentColor: color.fg2,
		inactiveBorderColor: color.lineStrong,
	};
}

/**
 * The switch: the switch-on track when on (the brand in light, a tan in dark
 * that holds 3:1 against the thumb and the surface), a raised track and a
 * quiet thumb when off.
 */
export function switchColors(color: ThemeColor): SwitchColors {
	return {
		checkedTrackColor: color.switchOn,
		checkedThumbColor: color.brandFg,
		checkedBorderColor: color.switchOn,
		uncheckedTrackColor: color.raised,
		uncheckedThumbColor: color.fg3,
		uncheckedBorderColor: color.lineStrong,
	};
}

/** The date picker dialog: the surface, fg text, a brand selected day. */
export function datePickerColors(color: ThemeColor): DatePickerElementColors {
	return {
		containerColor: color.surface,
		titleContentColor: color.fg2,
		headlineContentColor: color.fg,
		weekdayContentColor: color.fg2,
		subheadContentColor: color.fg2,
		navigationContentColor: color.fg2,
		yearContentColor: color.fg,
		disabledYearContentColor: color.fg3,
		currentYearContentColor: color.brand,
		selectedYearContentColor: color.brandFg,
		selectedYearContainerColor: color.brand,
		dayContentColor: color.fg,
		disabledDayContentColor: color.fg3,
		selectedDayContentColor: color.brandFg,
		selectedDayContainerColor: color.brand,
		todayContentColor: color.brand,
		todayDateBorderColor: color.brand,
		dividerColor: color.line,
	};
}

/** The dropdown field: a raised container, fg text, a quiet border (brand when open). */
export function dropdownFieldColors(color: ThemeColor): TextFieldColors {
	return {
		focusedContainerColor: color.raised,
		unfocusedContainerColor: color.raised,
		focusedTextColor: color.fg,
		unfocusedTextColor: color.fg,
		focusedIndicatorColor: color.brand,
		unfocusedIndicatorColor: color.lineStrong,
		cursorColor: color.brand,
		focusedTrailingIconColor: color.fg2,
		unfocusedTrailingIconColor: color.fg2,
	};
}
