/**
 * The keyed hash of a contact address (E2EE D11 Revision 3, PR 3a, plan
 * docs/roadmap/e2ee-d11-rev3.md): what finds a ghost (`shadow_profile`) or a
 * guest (`guest_session`) by address once the address is ciphertext.
 *
 *   emailHash = "<tag>:<hex>"   (see blind-index.ts)
 *   normalized = email.trim() with A to Z folded to a to z
 *
 * Only ASCII letters fold. Both lookup paths must agree on what "the same
 * address" means, and Postgres folds non-ASCII letters by its own rules (the
 * database locale, not JavaScript's), so a fold that goes further would make
 * the hash path and the plaintext path disagree on an address with an
 * accented capital. The plaintext path asks Postgres for a superset
 * (`mode: insensitive`) and `matchesContact` makes the answer exact in JS.
 *
 * The ring is the INSTANCE ring, and `blindIndex` signs with its lowest key
 * id, so adding a key never changes a hash. The label differs per table: the
 * same address gives different hashes for a ghost and a guest, so a dump does
 * not link the two tables. The hash is deterministic across the whole
 * instance (one key, not one per user); it is derived data, never sent to a
 * client, and not shredded with a user.
 *
 * THE ONE RULE (`contactHashFor`; every writer and `contactLookup` call it,
 * and nothing else decides):
 *   1. No master key: no hash, the plaintext path, never throws.
 *   2. Master key and the epoch set: the ring is required. A ring that cannot
 *      be had fails the write closed with `encrypted_text_unavailable`. A
 *      flag-off replica writes the hash too: it is derived data.
 *   3. Master key, no epoch: the hash when a ring exists (it never mints),
 *      else null. A cached "no ring" lasts 30 seconds (key-cache.ts), so a row
 *      written then has no hash; the start-up fill makes it.
 *
 * Call it outside any transaction: a transaction cannot load keys.
 */
import { blindIndex, blindIndexTag } from "~/server/crypto/blind-index";
import { loadEpoch } from "~/server/crypto/epoch";
import { FieldCryptoError, type Keyring } from "~/server/crypto/field-crypto";
import { TextUnavailableError } from "~/server/crypto/field-open";
import { getMasterKeyring } from "~/server/crypto/master-key";
import {
	findInstanceKeyring,
	getOrCreateInstanceKeyring,
	InstanceKeyError,
} from "./instance-key.service";

export type ContactTable = "shadow_profile" | "guest_session";

const LABELS: Record<ContactTable, string> = {
	shadow_profile: "retrospend shadow email hash v1",
	guest_session: "retrospend guest email hash v1",
};

/**
 * Prisma compiles `equals` with `mode: "insensitive"` to ILIKE and does not
 * escape the value (search-fold.ts), so `_` and `%` in an address would be
 * wildcards. Postgres's default LIKE escape is the backslash: escaping all
 * three makes the database match case-insensitive equality only.
 */
const escapeLike = (text: string): string =>
	text.replace(/[\\%_]/g, "\\$&");

/** The text two addresses are compared by, on the hash path and the plaintext path. */
export const normalizeContactEmail = (email: string): string =>
	email.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());

/** The key tag a table's hashes are made with; a stored hash counts only while its tag is this. */
export const contactHashTag = (ring: Keyring, table: ContactTable): string =>
	blindIndexTag(ring, LABELS[table]);

export function contactHash(
	ring: Keyring,
	table: ContactTable,
	email: string,
): string {
	const label = LABELS[table];
	return `${blindIndexTag(ring, label)}:${blindIndex(ring, label, normalizeContactEmail(email))}`;
}

/** A key store that cannot give the ring, as opposed to a bug. */
const isRingFailure = (error: unknown): error is Error & { code: string } =>
	error instanceof InstanceKeyError || error instanceof FieldCryptoError;

/**
 * The ring the rule asks for: undefined means "no hash" (rules 1 and 3), a
 * thrown `TextUnavailableError` means fail closed (rule 2).
 */
async function ringForRule(
	masterKeyring: Keyring | undefined,
): Promise<Keyring | undefined> {
	if (!masterKeyring) return undefined;
	if (await loadEpoch()) {
		try {
			return await getOrCreateInstanceKeyring(
				{ kind: "service" },
				masterKeyring,
			);
		} catch (error) {
			if (!isRingFailure(error)) throw error;
			throw new TextUnavailableError(error.code);
		}
	}
	try {
		return await findInstanceKeyring(masterKeyring);
	} catch (error) {
		if (!isRingFailure(error)) throw error;
		// Before the epoch nothing is sealed, so the plaintext path still
		// works. The code only: it names no address.
		console.warn(
			`Contact hash skipped, the key store gave no ring (${error.code})`,
		);
		return undefined;
	}
}

/**
 * The hash a writer stores next to `email`, by the rule in the file comment;
 * null for a null address or when the rule gives no hash. `masterKeyring`
 * defaults to the process's; undefined means none, for tests.
 */
export async function contactHashFor(
	table: ContactTable,
	email: string | null | undefined,
	masterKeyring: Keyring | undefined = getMasterKeyring(),
): Promise<string | null> {
	if (email === null || email === undefined) return null;
	const ring = await ringForRule(masterKeyring);
	return ring ? contactHash(ring, table, email) : null;
}

/** A `where` piece for the one table's `email` or `emailHash`. */
export type ContactWhere =
	| { emailHash: string }
	| { email: { equals: string; mode: "insensitive" } };

/**
 * Whether a row read through `where` (from `contactLookup`) is a match for
 * `email`. The hash path matched exactly in SQL, so every row is. The
 * plaintext path matched a superset (Postgres folds case by its own locale),
 * so the stored address is compared again with the one normalization both
 * paths share. The row must be read with its `email` on the plaintext path.
 */
export function matchesContact(
	where: ContactWhere,
	email: string,
	stored: string | null | undefined,
): boolean {
	if ("emailHash" in where) return true;
	return (
		stored !== null &&
		stored !== undefined &&
		normalizeContactEmail(stored) === normalizeContactEmail(email)
	);
}

/**
 * The only lookup of a ghost or a guest by address. With the epoch set and a
 * master key it matches the hash (rule 2 for the ring); otherwise the
 * normalized plaintext address, ignoring case, so matching does not depend on
 * the epoch. Resolve it before opening a transaction, and filter the rows it
 * finds with `matchesContact`.
 */
export async function contactLookup(
	table: ContactTable,
	email: string,
	masterKeyring: Keyring | undefined = getMasterKeyring(),
): Promise<ContactWhere> {
	if (masterKeyring && (await loadEpoch())) {
		const ring = await ringForRule(masterKeyring);
		if (ring) return { emailHash: contactHash(ring, table, email) };
	}
	return {
		email: {
			equals: escapeLike(normalizeContactEmail(email)),
			mode: "insensitive",
		},
	};
}

/**
 * `contactLookup` for a cleanup that must not be blocked by a lost key (an
 * account deletion): null, with the stable code logged and no address, when
 * the instance key is gone for good (`keystore_lost`); the sealed addresses
 * are unreadable without it anyway. Any other key problem is rethrown, so a
 * transient one makes the caller retry rather than silently skip. A writer
 * that stores a hash keeps the fail-closed rule instead.
 */
export async function contactLookupIfKeyed(
	table: ContactTable,
	email: string,
	masterKeyring: Keyring | undefined = getMasterKeyring(),
): Promise<ContactWhere | null> {
	try {
		return await contactLookup(table, email, masterKeyring);
	} catch (error) {
		if (
			!(error instanceof TextUnavailableError) ||
			error.code !== "keystore_lost"
		)
			throw error;
		console.warn(
			`Contact lookup skipped, the instance key is lost (${error.code})`,
		);
		return null;
	}
}
