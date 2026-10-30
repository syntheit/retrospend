import {
	Easing,
	FadeIn,
	FadeOut,
	LinearTransition,
	ReduceMotion,
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
