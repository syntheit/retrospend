/**
 * Generates a UUID with graceful fallback for browsers that lack crypto.randomUUID
 * (e.g., some mobile WebView/Edge variants).
 */
export function generateId(): string {
	if (typeof crypto !== "undefined") {
		if (typeof crypto.randomUUID === "function") {
			return crypto.randomUUID();
		}

		if (typeof crypto.getRandomValues === "function") {
			const bytes = crypto.getRandomValues(new Uint8Array(16));
			return formatAsUuid(bytes);
		}
	}

	// Last-resort fallback (non-cryptographic) that still matches UUID v4 format.
	const bytes = new Uint8Array(16);
	for (let i = 0; i < 16; i++) {
		bytes[i] = Math.floor(Math.random() * 256);
	}
	return formatAsUuid(bytes);
}

const formatAsUuid = (bytes: Uint8Array): string => {
	// Ensure we have exactly 16 bytes for UUID generation
	if (bytes.length !== 16) {
		throw new Error("UUID generation requires exactly 16 bytes");
	}

	// Set version (4) and variant bits to match UUID v4 format.
	// Type assertion is safe since we've verified the array length
	const uuidBytes = bytes as Uint8Array & { 6: number; 8: number };
	uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x40;
	uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;

	const byteToHex = Array.from(bytes, (byte) =>
		byte.toString(16).padStart(2, "0"),
	);

	return [
		byteToHex.slice(0, 4).join(""),
		byteToHex.slice(4, 6).join(""),
		byteToHex.slice(6, 8).join(""),
		byteToHex.slice(8, 10).join(""),
		byteToHex.slice(10, 16).join(""),
	].join("-");
};
