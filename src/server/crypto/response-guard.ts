/**
 * No sealed value may leave the server (E2EE D11, design section 7.1): mobile
 * caches responses, so a leak would persist. In tests the v1 handler and a
 * tRPC middleware check every response with this; the field-open extension
 * uses `hasSealedText` to refuse aggregate results it cannot open. A contact
 * hash (`emailHash`, services/keys/contact-hash.ts) never leaves either: it is
 * the same for one address across the whole instance.
 */

/** What a stored contact hash looks like: a 16 hex tag, a colon, 64 hex. */
const CONTACT_HASH = /^[0-9a-f]{16}:[0-9a-f]{64}$/;

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

/**
 * True when a field named `emailHash` holds a contact hash anywhere inside
 * `value`. The shape alone cannot be the test: a category's name index
 * (`nameIndex`, category-name-index.service.ts) has the same shape and rides
 * in whole category rows today, so the field name is part of the rule.
 */
export function hasContactHash(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(hasContactHash);
	if (value instanceof Map) return [...value.values()].some(hasContactHash);
	if (value instanceof Set) return [...value].some(hasContactHash);
	if (typeof value !== "object" || value === null) return false;
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) return false;
	const { emailHash } = value as { emailHash?: unknown };
	if (typeof emailHash === "string" && CONTACT_HASH.test(emailHash))
		return true;
	return Object.values(value).some(hasContactHash);
}

/**
 * Throws in tests when a response holds a sealed value or a contact hash; does
 * nothing elsewhere.
 */
export function assertNoSealedText(value: unknown, where: string): void {
	if (process.env.NODE_ENV !== "test") return;
	if (hasSealedText(value))
		throw new Error(`A sealed value reached a ${where} response`);
	if (hasContactHash(value))
		throw new Error(`A contact hash reached a ${where} response`);
}
