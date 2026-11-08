/**
 * Value equality for stored rows: plain objects and arrays by content, Dates
 * by time, and other values (Decimal) through `equals` when they have one,
 * else by their text. Two rows that differ only in key order are equal.
 */
const isPlain = (v: object) => {
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
};

export function sameValue(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (a === null || b === null) return false;
	if (typeof a !== "object" || typeof b !== "object") return false;
	if (a instanceof Date || b instanceof Date)
		return (
			a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
		);
	if (Array.isArray(a) || Array.isArray(b))
		return (
			Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((x, i) => sameValue(x, b[i]))
		);
	if (isPlain(a) && isPlain(b)) {
		const ak = Object.keys(a);
		const bk = Object.keys(b);
		return (
			ak.length === bk.length &&
			ak.every(
				(k) =>
					Object.hasOwn(b, k) &&
					sameValue(
						(a as Record<string, unknown>)[k],
						(b as Record<string, unknown>)[k],
					),
			)
		);
	}
	const eq = (a as { equals?: unknown }).equals;
	if (typeof eq === "function")
		return (eq as (o: unknown) => boolean).call(a, b);
	return String(a) === String(b);
}
