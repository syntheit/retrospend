import { contrast, over, type Rgba } from "@retrospend/tokens/color";
import { dark, light } from "@retrospend/tokens/theme";
import { segmentedColors, switchColors } from "./m3Colors";

/** `#rrggbb` or `#rrggbbaa` to channels in 0..1. */
function rgba(hex: string): Rgba {
	const n = (i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
	return {
		r: n(0) / 255,
		g: n(1) / 255,
		b: n(2) / 255,
		a: hex.length === 9 ? n(3) / 255 : 1,
	};
}

/** Text on a fill; a translucent fill is composited on `under` first. */
function ratio(text: string, fill: string, under: string): number {
	const base = rgba(under);
	return contrast(rgba(text), over(rgba(fill), base));
}

const themes = [
	["light", light],
	["dark", dark],
] as const;

// Every value is a token of the same theme, never a color made here.
const tokenValues = (color: Record<string, string>) =>
	new Set(Object.values(color));

describe.each(themes)("M3 token colors (%s)", (_name, theme) => {
	const { color } = theme;
	const segmented = segmentedColors(color);
	const sw = switchColors(color);

	it("maps the segment to brand-soft, raised and the text tokens", () => {
		expect(segmented).toEqual({
			activeContainerColor: color.brandSoft,
			activeContentColor: color.fg,
			activeBorderColor: color.brand,
			inactiveContainerColor: color.raised,
			inactiveContentColor: color.fg2,
			inactiveBorderColor: color.lineStrong,
		});
	});

	it("maps the switch to a brand track on and a raised track off", () => {
		expect(sw).toEqual({
			checkedTrackColor: color.brand,
			checkedThumbColor: color.brandFg,
			checkedBorderColor: color.brand,
			uncheckedTrackColor: color.raised,
			uncheckedThumbColor: color.fg3,
			uncheckedBorderColor: color.lineStrong,
		});
	});

	it("passes only token values", () => {
		const tokens = tokenValues(color);
		for (const value of [...Object.values(segmented), ...Object.values(sw)]) {
			expect(tokens.has(value as string)).toBe(true);
		}
	});

	it.each([
		["bg", color.bg],
		["surface", color.surface],
		["raised", color.raised],
	])("keeps the selected label at 4.5:1 over %s", (_label, under) => {
		expect(ratio(color.fg, color.brandSoft, under)).toBeGreaterThanOrEqual(4.5);
	});

	it("keeps the unselected label at 4.5:1 on raised", () => {
		expect(ratio(color.fg2, color.raised, color.raised)).toBeGreaterThanOrEqual(
			4.5,
		);
	});

	it("keeps the switch thumb readable on both tracks", () => {
		expect(ratio(color.brandFg, color.brand, color.bg)).toBeGreaterThanOrEqual(
			4.5,
		);
		expect(ratio(color.fg3, color.raised, color.bg)).toBeGreaterThanOrEqual(
			4.5,
		);
	});

	it("tells the on track from the off track", () => {
		expect(
			contrast(rgba(color.brand), rgba(color.raised)),
		).toBeGreaterThanOrEqual(3);
	});
});
