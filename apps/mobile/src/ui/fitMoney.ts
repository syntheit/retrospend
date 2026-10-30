/**
 * A figure never ends in an ellipsis (GUIDELINE §7): it shrinks to fit its
 * line down to this floor and, past the floor, is clipped, never "$1,2...".
 * Spread onto a single-line money Text.
 */
export const fitMoney = {
	numberOfLines: 1,
	adjustsFontSizeToFit: true,
	minimumFontScale: 0.5,
	ellipsizeMode: "clip",
} as const;
