// Color math for the design tokens: OKLCH and OKLab to sRGB, color-mix in
// OKLab, WCAG contrast. Used to generate hex values for native platforms and
// by the contrast tests (src/test/uiRules/tokens.test.ts, GUIDELINE §14).
//
// Numbers follow CSS Color 4: OKLab to linear sRGB with the Ottosson matrices,
// then the sRGB transfer curve. Out-of-gamut channels are clipped, which is
// what browsers do for these mid-chroma values.

export type Rgba = { r: number; g: number; b: number; a: number }; // 0..1 sRGB, gamma encoded
type Lab = { L: number; a: number; b: number; alpha: number };

const clamp = (x: number) => Math.min(1, Math.max(0, x));

function oklchToLab(L: number, C: number, h: number, alpha = 1): Lab {
	const rad = (h * Math.PI) / 180;
	return { L, a: C * Math.cos(rad), b: C * Math.sin(rad), alpha };
}

function labToLinear({ L, a, b }: Lab): [number, number, number] {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
}

function linearToLab([r, g, b]: [number, number, number], alpha = 1): Lab {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return {
		L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
		alpha,
	};
}

const encode = (x: number) =>
	x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
const decode = (x: number) =>
	x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;

function labToRgba(lab: Lab): Rgba {
	const [r, g, b] = labToLinear(lab).map((v) => encode(clamp(v))) as [
		number,
		number,
		number,
	];
	return { r, g, b, a: lab.alpha };
}

function rgbaToLab(c: Rgba): Lab {
	return linearToLab([decode(c.r), decode(c.g), decode(c.b)], c.a);
}

/**
 * Parse `oklch(L C h)`, `oklch(L C h / a)`, `rgb(r g b / a)` (0..255) or
 * `color-mix(in oklab, ...)` over any of those.
 */
export function parseColor(text: string): Rgba {
	const s = text.trim();
	const ok =
		/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(
			s,
		);
	if (ok) {
		return labToRgba(
			oklchToLab(
				Number(ok[1]),
				Number(ok[2]),
				Number(ok[3]),
				ok[4] === undefined ? 1 : Number(ok[4]),
			),
		);
	}
	const rgb =
		/^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(
			s,
		);
	if (rgb) {
		return {
			r: Number(rgb[1]) / 255,
			g: Number(rgb[2]) / 255,
			b: Number(rgb[3]) / 255,
			a: rgb[4] === undefined ? 1 : Number(rgb[4]),
		};
	}
	const mix = /^color-mix\(\s*in oklab\s*,(.*)\)$/.exec(s);
	if (mix) return parseMix(mix[1] as string);
	throw new Error(`unsupported color: ${text}`);
}

/** The arguments of `color-mix(in oklab, a p%, b)`; b may be `transparent`. */
function parseMix(args: string): Rgba {
	const [first, second] = splitTopLevel(args);
	const weighted = /^(.*\S)\s+([\d.]+)%$/.exec(first?.trim() ?? "");
	if (!weighted || !second) throw new Error(`unsupported color-mix: ${args}`);
	const b = second.trim();
	return mixOklab(
		parseColor(weighted[1] as string),
		Number(weighted[2]),
		b === "transparent" ? undefined : parseColor(b),
	);
}

/** Split on the commas that are not inside parentheses. */
function splitTopLevel(text: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "(") depth++;
		else if (text[i] === ")") depth--;
		else if (text[i] === "," && depth === 0) {
			parts.push(text.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(text.slice(start));
	return parts;
}

/** CSS `color-mix(in oklab, a p%, b)`; `b` undefined means transparent. */
export function mixOklab(a: Rgba, pct: number, b?: Rgba): Rgba {
	const p = pct / 100;
	const la = rgbaToLab(a);
	if (!b) return labToRgba({ ...la, alpha: la.alpha * p });
	const lb = rgbaToLab(b);
	// Premultiplied interpolation, as CSS Color 5 specifies.
	const alpha = la.alpha * p + lb.alpha * (1 - p);
	const pre = (x: number, y: number) =>
		alpha === 0 ? 0 : (x * la.alpha * p + y * lb.alpha * (1 - p)) / alpha;
	return labToRgba({
		L: pre(la.L, lb.L),
		a: pre(la.a, lb.a),
		b: pre(la.b, lb.b),
		alpha,
	});
}

export function toHex(c: Rgba): string {
	const h = (x: number) =>
		Math.round(clamp(x) * 255)
			.toString(16)
			.padStart(2, "0");
	const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
	return c.a >= 0.9995 ? base : `${base}${h(c.a)}`;
}

/** Composite a translucent color over an opaque one (for contrast checks). */
export function over(top: Rgba, under: Rgba): Rgba {
	const a = top.a;
	return {
		r: top.r * a + under.r * (1 - a),
		g: top.g * a + under.g * (1 - a),
		b: top.b * a + under.b * (1 - a),
		a: 1,
	};
}

function luminance(c: Rgba): number {
	return 0.2126 * decode(c.r) + 0.7152 * decode(c.g) + 0.0722 * decode(c.b);
}

/** WCAG 2 contrast ratio between two opaque colors. */
export function contrast(x: Rgba, y: Rgba): number {
	const a = luminance(x);
	const b = luminance(y);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
