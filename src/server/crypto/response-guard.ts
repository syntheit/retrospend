/**
 * No sealed value may leave the server (E2EE D11, design section 7.1): mobile
 * caches responses, so a leak would persist. In tests the v1 handler and a
 * tRPC middleware check every response with this; the field-open extension
 * uses `hasSealedText` to refuse aggregate results it cannot open.
 */

/** True when any string inside `value` is ciphertext (starts with U+0001). */
export function hasSealedText(value: unknown): boolean {
	if (typeof value === "string") return value.startsWith("\u0001");
	if (Array.isArray(value)) return value.some(hasSealedText);
	if (value instanceof Map)
		return [...value].some(([k, v]) => hasSealedText(k) || hasSealedText(v));
	if (value instanceof Set) return [...value].some(hasSealedText);
	if (typeof value !== "object" || value === null) return false;
	// Plain objects only: a Date or a Decimal holds no text.
	const proto = Object.getPrototypeOf(value);
	return (
		(proto === Object.prototype || proto === null) &&
		Object.values(value).some(hasSealedText)
	);
}

/** Throws in tests when a response holds a sealed value; does nothing elsewhere. */
export function assertNoSealedText(value: unknown, where: string): void {
	if (process.env.NODE_ENV === "test" && hasSealedText(value))
		throw new Error(`A sealed value reached a ${where} response`);
}
