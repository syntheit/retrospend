/**
 * What a key change may contain, checked before any query. The server never
 * decrypts a wrap, so this is shape only: role, target, header and length, the
 * same facts the migration's CHECKs pin (20261115200000_protection_keys), and
 * the Argon2 floor, which only the service enforces so that raising it needs no
 * migration. Sizes come from @retrospend/crypto, so a format change there fails
 * the unit test with real wraps before it fails in production.
 */
import {
	checkArgon2Params,
	KEY_BYTES,
	NONCE_BYTES,
	PUBLIC_KEY_BYTES,
	PUBLIC_ROLES,
	SALT_BYTES,
	SEAL_OVERHEAD_BYTES,
	SYMMETRIC_ROLES,
	TAG_BYTES,
} from "@retrospend/crypto";
import { ProtectionKeysError } from "./errors";

export type WrapRole =
	| (typeof SYMMETRIC_ROLES)[number]
	| (typeof PUBLIC_ROLES)[number];

/** Roles whose AAD id is the user's own id (keys.ts), so the target is fixed. */
const OWN_TARGET_ROLES: readonly WrapRole[] = [
	"ak-password",
	"ak-recovery",
	"private-key",
];

/** keys.ts `ID`: the pattern an id must match to be bound into a wrap. */
const TARGET_ID = /^[A-Za-z0-9_-]{1,64}$/;
const WRAP_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** More than a person ever holds (collections, devices and contacts); bounds a request. */
export const MAX_CHANGES = 500;

const HEADER_BYTES = 2;
const SYMMETRIC_WRAP_BYTES = HEADER_BYTES + NONCE_BYTES + KEY_BYTES + TAG_BYTES;
/** The sealed plaintext is the key plus a 16-byte binding (keys.ts BINDING_BYTES). */
const PUBLIC_WRAP_BYTES = HEADER_BYTES + KEY_BYTES + 16 + SEAL_OVERHEAD_BYTES;

export type KeySetParams = {
	kdfSalt: Uint8Array;
	kdfMemoryKiB: number;
	kdfPasses: number;
};
export type WrapInput = {
	/** Client-generated; the database makes one when absent. */
	id?: string;
	role: WrapRole;
	targetId: string;
	wrapped: Uint8Array;
};
export type WrapRef = Pick<WrapInput, "role" | "targetId">;
export type KeyChanges = {
	/** The version the caller read; 0 creates the key set. */
	baseVersion: number;
	/** Required (with `publicKey`) to create the set; parameters only afterwards. */
	set?: KeySetParams & { publicKey?: Uint8Array };
	put: WrapInput[];
	remove: WrapRef[];
};

function invalid(): never {
	throw new ProtectionKeysError("invalid_input");
}

const isSymmetric = (role: string): boolean =>
	(SYMMETRIC_ROLES as readonly string[]).includes(role);
const isPublic = (role: string): boolean =>
	(PUBLIC_ROLES as readonly string[]).includes(role);

function checkRef(ref: WrapRef, userId: string): void {
	if (!isSymmetric(ref.role) && !isPublic(ref.role)) invalid();
	if (typeof ref.targetId !== "string" || !TARGET_ID.test(ref.targetId))
		invalid();
	if (OWN_TARGET_ROLES.includes(ref.role) && ref.targetId !== userId) invalid();
}

function checkWrap(wrap: WrapInput, userId: string): void {
	checkRef(wrap, userId);
	if (wrap.id !== undefined && !WRAP_ID.test(wrap.id)) invalid();
	const bytes = wrap.wrapped;
	if (!(bytes instanceof Uint8Array)) invalid();
	// Version 1, then 1 (symmetric) or 2 (sealed to a public key).
	const symmetric = isSymmetric(wrap.role);
	if (bytes[0] !== 1 || bytes[1] !== (symmetric ? 1 : 2)) invalid();
	if (bytes.length !== (symmetric ? SYMMETRIC_WRAP_BYTES : PUBLIC_WRAP_BYTES))
		invalid();
}

function checkParams(set: KeySetParams): void {
	if (!(set.kdfSalt instanceof Uint8Array) || set.kdfSalt.length !== SALT_BYTES)
		invalid();
	try {
		checkArgon2Params({
			memoryKiB: set.kdfMemoryKiB,
			passes: set.kdfPasses,
		});
	} catch {
		invalid();
	}
}

/** Throws `invalid_input` for anything a stored change could not hold. */
export function validateKeyChanges(userId: string, changes: KeyChanges): void {
	const { baseVersion, set, put, remove } = changes;
	if (!Number.isInteger(baseVersion) || baseVersion < 0) invalid();
	if (!Array.isArray(put) || !Array.isArray(remove)) invalid();
	if (put.length + remove.length > MAX_CHANGES) invalid();
	if (baseVersion === 0) {
		// Creating: the parameters and the public key, once. The app role cannot
		// update the public key later, so a later change may not name one.
		if (!set) invalid();
		const key = set.publicKey;
		if (!(key instanceof Uint8Array) || key.length !== PUBLIC_KEY_BYTES)
			invalid();
	} else {
		if (set?.publicKey !== undefined) invalid();
		// A change that changes nothing would still bump the version.
		if (!set && put.length === 0 && remove.length === 0) invalid();
	}
	if (set) checkParams(set);
	const seen = new Set<string>();
	const ids = new Set<string>();
	for (const wrap of put) {
		checkWrap(wrap, userId);
		const slot = `${wrap.role}|${wrap.targetId}`;
		if (seen.has(slot)) invalid();
		seen.add(slot);
		// A repeated id is a malformed request, not a race: conflict would
		// tell the client to re-read and send the same thing again.
		if (wrap.id !== undefined) {
			if (ids.has(wrap.id)) invalid();
			ids.add(wrap.id);
		}
	}
	for (const ref of remove) checkRef(ref, userId);
}
