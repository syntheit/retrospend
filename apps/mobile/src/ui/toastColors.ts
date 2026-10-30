import type { Theme } from "@/theme";

/**
 * The toast is the inverted pill: the page color on the text color. Undo is
 * the page color too, underlined (the mockup, kit.css), so it is as readable
 * as the message in both schemes. The accent on this pill was 2.1:1 in dark.
 */
export function toastColors(color: Theme["color"]) {
	return { fill: color.fg, text: color.bg, undo: color.bg };
}
