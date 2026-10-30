import { light } from "@retrospend/tokens/theme";
import { useEffect, useRef } from "react";
import {
	Easing,
	FadeIn,
	FadeInLeft,
	FadeInRight,
	FadeOut,
	LinearTransition,
	ReduceMotion,
	useReducedMotion,
} from "react-native-reanimated";
import type { Theme } from "@/theme";

/**
 * The app's motion vocabulary (docs/ui/MOTION-mobile.md, GUIDELINE §11):
 * token durations, the land and leave curves, no spring, no overshoot.
 * Movement respects the system's reduced motion (it jumps); fades always
 * run, so reduced motion is opacity only.
 */

/** Things arriving (ease out). */
export function easeLand(theme: Theme) {
	const [a = 0, b = 0, c = 1, d = 1] = theme.easing.land;
	return Easing.bezier(a, b, c, d);
}

/** Things leaving (ease in). */
export function easeLeave(theme: Theme) {
	const [a = 0, b = 0, c = 1, d = 1] = theme.easing.leave;
	return Easing.bezier(a, b, c, d);
}

/** A row joining a list that is already on screen: it fades in (200). */
export function rowEnter(theme: Theme) {
	return FadeIn.duration(theme.duration.row)
		.easing(easeLand(theme))
		.reduceMotion(ReduceMotion.Never);
}

/** A row leaving: it fades out (200) while the rows under it close the gap. */
export function rowExit(theme: Theme) {
	return FadeOut.duration(theme.duration.row)
		.easing(easeLeave(theme))
		.reduceMotion(ReduceMotion.Never);
}

/** The rows around an insert or a removal slide to their place (200); movement, so reduced motion jumps. */
export function rowLayout(theme: Theme) {
	return LinearTransition.duration(theme.duration.row)
		.easing(easeLand(theme))
		.reduceMotion(ReduceMotion.System);
}

/** Loading placeholders hand over to the content with a short fade (120). */
export function placeholderExit(theme: Theme) {
	return FadeOut.duration(theme.duration.state).reduceMotion(
		ReduceMotion.Never,
	);
}

/**
 * The pane under underline tabs arriving after a switch: it fades in while
 * it slides a short way along the tabs' axis, from the side of the tab it
 * comes from (220, the land curve). Reduced motion: the fade alone. Nothing
 * on the first render, so a page never animates on load. Put it as the
 * `entering` of a view keyed by the open tab.
 */
export function usePaneEnter(index: number) {
	// Durations and curves are the same in both themes.
	const theme = light;
	const reduce = useReducedMotion();
	// The tab on screen at the last commit: a render that differs from it is
	// the switch.
	const shown = useRef(index);
	useEffect(() => {
		shown.current = index;
	}, [index]);
	const from = shown.current;
	if (from === index) return undefined;
	const base = reduce ? FadeIn : index > from ? FadeInRight : FadeInLeft;
	return base
		.duration(theme.duration.tab)
		.easing(easeLand(theme))
		.reduceMotion(ReduceMotion.Never);
}
