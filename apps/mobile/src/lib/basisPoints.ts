/**
 * "12.5" as hundredths of a percent (1250), read from the text so no float is
 * involved. Up to three digits before the point. `comma` also accepts "12,5";
 * `truncate` takes any number of decimals and drops those past the second,
 * otherwise a third decimal is not a number. Null when the text is not one.
 */
export function parseBasisPoints(
	text: string,
	options: { comma?: boolean; truncate?: boolean } = {},
): number | null {
	const point = options.comma ? "[.,]" : "\\.";
	const digits = options.truncate ? "\\d+" : "\\d{1,2}";
	const match = new RegExp(`^(\\d{1,3})(?:${point}(${digits}))?$`).exec(
		text.trim(),
	);
	if (!match) return null;
	const whole = Number(match[1]);
	const fraction = Number(`${match[2] ?? ""}00`.slice(0, 2));
	return whole * 100 + fraction;
}
