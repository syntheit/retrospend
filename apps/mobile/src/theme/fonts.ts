import { light } from "@retrospend/tokens/theme";

/**
 * DM Sans, one loaded face per weight token (app/_layout.tsx loads them).
 * A custom face is picked by family, not by fontWeight: Android would
 * synthesize a bold from the regular face otherwise.
 */
const REGULAR = "DMSans_400Regular";
export const FONT_FAMILY = {
	[light.font.weight.normal]: REGULAR,
	[light.font.weight.medium]: "DMSans_500Medium",
	[light.font.weight.semibold]: "DMSans_600SemiBold",
} as const satisfies Record<number, string>;

/** The DM Sans face for a weight token value (400, 500 or 600). */
export function fontFamilyFor(weight: number): string {
	return FONT_FAMILY[weight] ?? REGULAR;
}
