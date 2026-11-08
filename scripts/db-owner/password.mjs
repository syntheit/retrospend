// The owner's password, derived from the superuser's, and the other secrets of
// a start: URLs with another role's name, SCRAM verifiers. No new secret needs
// configuring (see deriveOwnerPassword).
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { OWNER_ROLE } from "./constants.mjs";

/**
 * The password of the owner role: hex(HMAC-SHA256(key = the superuser's
 * password, message = "retrospend_owner")). The key is the password as the
 * URL spells it after percent-decoding, as UTF-8 bytes. Anyone holding the
 * superuser password can derive it, which they could not gain anything from;
 * the owner password reveals nothing about the superuser's (HMAC is one-way).
 * It changes when the superuser's does. The Go sidecar derives the same value
 * (shared vectors: vectors.json).
 *
 * @param {string} superuserPassword
 */
export function deriveOwnerPassword(superuserPassword) {
	return createHmac("sha256", Buffer.from(superuserPassword, "utf8"))
		.update(OWNER_ROLE)
		.digest("hex");
}

/**
 * The password of a connection URL as the database sees it, or null when the
 * URL has none or does not parse.
 *
 * @param {string} connectionString
 * @returns {string | null}
 */
export function urlPassword(connectionString) {
	try {
		const raw = new URL(connectionString).password;
		if (!raw) return null;
		return decodeURIComponent(raw);
	} catch {
		return null;
	}
}

/**
 * The URL with the owner's name and password in place of the superuser's;
 * host, database and query string stay.
 *
 * @param {string} connectionString
 * @param {string} ownerPassword
 */
export function ownerUrl(connectionString, ownerPassword) {
	return roleUrl(connectionString, OWNER_ROLE, ownerPassword);
}

/**
 * The URL with another role's name and password.
 *
 * @param {string} connectionString
 * @param {string} role
 * @param {string} password
 */
export function roleUrl(connectionString, role, password) {
	const url = new URL(connectionString);
	url.username = role;
	url.password = password;
	return url.toString();
}

/**
 * A SCRAM-SHA-256 verifier for ALTER ROLE ... PASSWORD, so the plain password
 * never reaches the server (or its logs). A random salt and 4096 iterations,
 * Postgres's own default. Only for printable ASCII, where SASLprep (which
 * Postgres applies) changes nothing.
 *
 * @param {string} password
 * @param {Buffer} [salt]
 * @param {number} [iterations]
 */
export function scramVerifier(
	password,
	salt = randomBytes(16),
	iterations = 4096,
) {
	if (!/^[\x21-\x7e]+$/.test(password)) {
		throw new Error(
			"The owner password must be printable ASCII without spaces",
		);
	}
	if (iterations < 4096) throw new Error("Use at least 4096 iterations");
	const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
	const clientKey = createHmac("sha256", salted).update("Client Key").digest();
	const storedKey = createHash("sha256").update(clientKey).digest();
	const serverKey = createHmac("sha256", salted).update("Server Key").digest();
	return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}
