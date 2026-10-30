import type {
	SegmentedButtonColors,
	SwitchColors,
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
 * states (M3 draws them as a wash of the on-surface color), the ripple and
 * the dropdown field (its anchor is the universal Picker, which takes no
 * colors).
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

/** The switch: a brand track when on, a raised track and a quiet thumb when off. */
export function switchColors(color: ThemeColor): SwitchColors {
	return {
		checkedTrackColor: color.brand,
		checkedThumbColor: color.brandFg,
		checkedBorderColor: color.brand,
		uncheckedTrackColor: color.raised,
		uncheckedThumbColor: color.fg3,
		uncheckedBorderColor: color.lineStrong,
	};
}
