import { contrast, type Rgba } from "@retrospend/tokens/color";
import { dark, light } from "@retrospend/tokens/theme";
import { toastColors } from "./toastColors";

/** `#rrggbb` to channels in 0..1. */
function rgba(hex: string): Rgba {
	const n = (i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
	return { r: n(0) / 255, g: n(1) / 255, b: n(2) / 255, a: 1 };
}

describe.each([
	["light", light],
	["dark", dark],
] as const)("toast colors (%s)", (_name, theme) => {
	const colors = toastColors(theme.color);

	it("draws Undo in the page color, as the message", () => {
		expect(colors.undo).toBe(theme.color.bg);
		expect(colors.text).toBe(theme.color.bg);
	});

	it("keeps Undo and the message at 4.5:1 on the pill", () => {
		expect(
			contrast(rgba(colors.undo), rgba(colors.fill)),
		).toBeGreaterThanOrEqual(4.5);
		expect(
			contrast(rgba(colors.text), rgba(colors.fill)),
		).toBeGreaterThanOrEqual(4.5);
	});
});
