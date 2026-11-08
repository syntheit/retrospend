/**
 * The server master key (docs/roadmap/e2ee-spike.md 4.6, lane D). It wraps the
 * per-user data keys (D2) and is held outside the database: in
 * DATA_MASTER_KEY, or in the file DATA_MASTER_KEY_FILE names (a Docker or
 * Kubernetes secret).
 *
 * Setting form, one or more entries separated by commas or whitespace:
 *
 *   <id>:<64 hex characters>      for example  2:9f1c...,1:03aa...
 *   <64 hex characters>           a single bare key, which is id 1
 *
 * `openssl rand -hex 32` makes a key. The first entry is the current key and
 * seals; the others only open. Rotation: put the new key first with the next
 * id and keep the old one, restart, run the rewrap job (D12), then drop the
 * old entry. A key that is set but malformed, unreadable, all zero, given
 * twice or given both ways stops the server at start (`assertMasterKeyConfig`
 * from instrumentation.ts) instead of falling back to no encryption. With
 * neither setting present the master key is simply absent, as today.
 *
 * Nothing here logs a key, and no error names one.
 */
import { readFileSync } from "node:fs";
import { env } from "~/env";
import { FieldCryptoError, Keyring } from "./field-crypto";

export type MasterKeySource = {
	DATA_MASTER_KEY?: string | undefined;
	DATA_MASTER_KEY_FILE?: string | undefined;
};

const ENTRY = /^(?:([1-9][0-9]{0,9}):)?([0-9a-fA-F]{64})$/;
const MAX_KEY_ID = 0xffffffff;

function readSetting(source: MasterKeySource): string | undefined {
	const inline = source.DATA_MASTER_KEY;
	const file = source.DATA_MASTER_KEY_FILE;
	if (inline && file) throw new FieldCryptoError("bad_key");
	if (inline) return inline;
	if (!file) return undefined;
	try {
		return readFileSync(file, "utf8");
	} catch {
		throw new FieldCryptoError("bad_key");
	}
}

/** The keyring the setting describes, undefined when it is not set. */
export function loadMasterKeyring(
	source: MasterKeySource,
): Keyring | undefined {
	const text = readSetting(source);
	if (text === undefined) return undefined;
	const parts = text.split(/[\s,]+/).filter((part) => part.length > 0);
	if (parts.length === 0) throw new FieldCryptoError("bad_key");
	const entries = parts.map((part) => {
		const [, rawId, hex] = ENTRY.exec(part) ?? [];
		// A bare key has no id and so stands alone.
		if (hex === undefined || (rawId === undefined && parts.length > 1))
			throw new FieldCryptoError("bad_key");
		const id = rawId === undefined ? 1 : Number(rawId);
		if (id > MAX_KEY_ID) throw new FieldCryptoError("bad_key");
		return { id, key: Buffer.from(hex, "hex") };
	});
	return new Keyring(entries);
}

let cached: { keyring: Keyring | undefined } | undefined;

/** The process's master keyring, loaded once. Undefined when not configured. */
export function getMasterKeyring(): Keyring | undefined {
	cached ??= { keyring: loadMasterKeyring(env) };
	return cached.keyring;
}

/** Test hook: forget the loaded keyring. */
export function resetMasterKeyringForTests(): void {
	cached = undefined;
}

/**
 * Called when the server starts. Throws, with no key material in the message,
 * when the setting is present but cannot be used.
 */
export function assertMasterKeyConfig(): void {
	try {
		getMasterKeyring();
	} catch (error) {
		cached = undefined;
		const code = error instanceof FieldCryptoError ? error.code : "bad_key";
		throw new Error(
			`DATA_MASTER_KEY or DATA_MASTER_KEY_FILE is not usable (${code}). Expected 64 hex characters, optionally as <id>:<hex> entries; see docs/self-hosting.md.`,
		);
	}
}
