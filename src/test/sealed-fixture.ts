/**
 * Sealed rows for pg tests (E2EE D11 PR 3.2). Nothing in the app seals until
 * PR 4, so a test writes ciphertext itself: keys come from the PR 2 getters
 * (which mint), and the sealed value is written with raw SQL on the admin
 * client, so no extension sees it. Every sealed cell is read back raw and
 * must start with the wire prefix, so a test cannot pass on plaintext.
 *
 * The app's clients get the test's master key through a `vi.mock` of
 * `getMasterKeyring` in each test file (vi.mock cannot be shared).
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll } from "vitest";
import { resetEpochForTests, setEpochReader } from "~/server/crypto/epoch";
import {
	type FieldAad,
	Keyring,
	sealField,
} from "~/server/crypto/field-crypto";
import {
	FIELD_MAP,
	jsonColumns,
	keyClassOfColumn,
	mappedColumns,
	modelOfTable,
	ownerOfTable,
} from "~/server/crypto/fields";
import { keystoreDb } from "~/server/db-core";
import { userTransaction } from "~/server/db-tx";
import {
	evictDataKeyring,
	getOrCreateDataKeyring,
} from "~/server/services/keys/data-key.service";
import { readFieldEncryptionEpoch } from "~/server/services/keys/field-encryption-start";
import {
	evictInstanceKeyring,
	getOrCreateInstanceKeyring,
} from "~/server/services/keys/instance-key.service";
import { adminDb } from "./pg-harness";

export const newMasterKeyring = () =>
	new Keyring([{ id: 1, key: randomBytes(32) }]);

/**
 * The user's data keys, minted on first use. A mint drops the cached ring,
 * as PR 4's seal path will, so a "no key" cached before it is not served.
 */
export async function userKeyring(userId: string, master: Keyring) {
	const ring = await userTransaction(keystoreDb, userId, (tx) =>
		getOrCreateDataKeyring(tx, master),
	);
	evictDataKeyring(userId);
	return ring;
}

/** The instance key, minted on first use. */
export const instanceKeyring = (master: Keyring) =>
	getOrCreateInstanceKeyring({ kind: "service" }, master);

function mappedCell(table: string, column: string): void {
	if (!keyClassOfColumn(table, column))
		throw new Error(`${table}.${column} is not a mapped cell`);
}

/** The value stored in one cell, read raw. */
export async function storedValue(
	table: string,
	column: string,
	rowId: string,
): Promise<unknown> {
	mappedCell(table, column);
	const rows = await adminDb.$queryRawUnsafe<Record<string, unknown>[]>(
		`SELECT "${column}" AS "value" FROM "${table}" WHERE "id" = $1`,
		rowId,
	);
	return rows[0]?.value;
}

const setCell = (
	table: string,
	column: string,
	rowId: string,
	value: unknown,
) =>
	adminDb.$executeRawUnsafe(
		`UPDATE "${table}" SET "${column}" = $1 WHERE "id" = $2`,
		value,
		rowId,
	);

/** What each written cell held before, newest last, for `restoreCells`. */
const written: {
	table: string;
	column: string;
	rowId: string;
	was: unknown;
}[] = [];

/** Writes a raw value into one cell. */
export async function writeCell(
	table: string,
	column: string,
	rowId: string,
	value: string,
): Promise<void> {
	mappedCell(table, column);
	const was = await storedValue(table, column, rowId);
	if ((await setCell(table, column, rowId, value)) !== 1)
		throw new Error(`No ${table} row to seal`);
	written.push({ table, column, rowId, was });
}

/**
 * Puts back what every written cell held. A worker's database outlives the
 * file, and the keys that sealed these cells do not: a later file that reads
 * every user or project would meet ciphertext it cannot open. Call it in
 * `afterAll`.
 */
export async function restoreCells(): Promise<void> {
	for (const { table, column, rowId, was } of written.splice(0).reverse())
		await setCell(table, column, rowId, was);
}

/**
 * Replaces every sealed cell in the database with a placeholder, unique per
 * row (a category name is unique per user). For files whose writes seal
 * through the app: the keys go with the file, so a later file in this
 * worker's database that reads every user or project would meet ciphertext
 * it cannot open. Call it in `afterAll`.
 */
export async function unsealAll(): Promise<void> {
	for (const [table, column] of mappedColumns())
		await adminDb.$executeRawUnsafe(
			`UPDATE "${table}" SET "${column}" = 'unsealed ' || "id" WHERE starts_with("${column}", E'\\x01')`,
		);
	for (const [table, column] of jsonColumns())
		await adminDb.$executeRawUnsafe(
			`UPDATE "${table}" SET "${column}" = jsonb_build_object('unsealed', "id") WHERE starts_with(COALESCE("${column}"->>'sealed', ''), E'\\x01')`,
		);
}

/** Seals `plaintext` into one cell with `ring` and checks it is stored sealed. */
export async function sealCell(
	ring: Keyring,
	cell: FieldAad,
	plaintext: string,
): Promise<string> {
	const sealed = sealField(ring, plaintext, cell);
	await writeCell(cell.table, cell.column, cell.rowId, sealed);
	const stored = await storedValue(cell.table, cell.column, cell.rowId);
	if (typeof stored !== "string" || !stored.startsWith("\u0001k1:"))
		throw new Error(`${cell.table}.${cell.column} is not sealed at rest`);
	return sealed;
}

/**
 * Seals every mapped cell of a row that holds text, each with its class's
 * key (a user-class cell with its row owner's), and returns the plaintexts.
 */
export async function sealRow(
	master: Keyring,
	table: string,
	rowId: string,
): Promise<Record<string, string>> {
	const model = modelOfTable(table);
	if (!model) throw new Error(`${table} has no mapped cells`);
	const [row] = await adminDb.$queryRawUnsafe<Record<string, unknown>[]>(
		`SELECT * FROM "${table}" WHERE "id" = $1`,
		rowId,
	);
	if (!row) throw new Error(`No ${table} row to seal`);
	const plain: Record<string, string> = {};
	for (const [column, cls] of Object.entries(FIELD_MAP[model].columns)) {
		const value = row[column];
		if (typeof value !== "string" || value === "") continue;
		const ring =
			cls === "user"
				? await userKeyring(row[ownerOfTable(table).column] as string, master)
				: await instanceKeyring(master);
		await sealCell(ring, { table, column, rowId }, value);
		plain[column] = value;
	}
	return plain;
}

/** Seals `plaintext` into one cell with the key its class names (the row owner's for a user-class cell). */
export async function sealText(
	master: Keyring,
	cell: FieldAad,
	plaintext: string,
): Promise<string> {
	const cls = keyClassOfColumn(cell.table, cell.column);
	if (!cls)
		throw new Error(`${cell.table}.${cell.column} is not a mapped cell`);
	if (cls === "instance")
		return sealCell(await instanceKeyring(master), cell, plaintext);
	const owner = ownerOfTable(cell.table).column;
	const [row] = await adminDb.$queryRawUnsafe<{ owner: string }[]>(
		`SELECT "${owner}" AS "owner" FROM "${cell.table}" WHERE "id" = $1`,
		cell.rowId,
	);
	if (!row) throw new Error(`No ${cell.table} row to seal`);
	return sealCell(await userKeyring(row.owner, master), cell, plaintext);
}

/**
 * Sets or clears the field encryption epoch in the database and forgets the
 * process cache, so the next caller loads it cold, as a fresh process would.
 */
export async function writeEpoch(set: boolean): Promise<void> {
	const since = set ? new Date("2026-11-11T00:00:00Z") : null;
	await adminDb.$executeRaw`
		INSERT INTO "app_settings" ("id", "updatedAt", "fieldEncryptionSince")
		VALUES ('app_settings_singleton', now(), ${since})
		ON CONFLICT ("id") DO UPDATE SET "fieldEncryptionSince" = EXCLUDED."fieldEncryptionSince"`;
	resetEpochForTests();
}

/**
 * The next epoch read fails (the column unreadable for a moment); later
 * reads go to the database again. Call `writeEpoch` first: it forgets the
 * cache, so the next caller reads.
 */
export function failNextEpochRead(): void {
	let fail = true;
	setEpochReader(() => {
		if (!fail) return readFieldEncryptionEpoch();
		fail = false;
		return Promise.reject(new Error("epoch unreadable"));
	});
}

/** No instance key and no instance key date, as on a new install. */
export async function resetInstanceKey(): Promise<void> {
	evictInstanceKeyring();
	await adminDb.$executeRaw`DELETE FROM keystore."instance_text_key"`;
	await adminDb.$executeRaw`UPDATE "app_settings" SET "instanceKeySince" = NULL`;
}

/**
 * The hooks every file that seals needs: a fresh master key for the app's
 * clients (through the file's `vi.mock` of getMasterKeyring, which reads
 * `master.ring`) and a fresh instance key, and afterwards the cells put back
 * and the instance key gone, so the next file in this database starts clean.
 */
export function sealedFile(master: { ring: Keyring | undefined }): void {
	beforeAll(async () => {
		await resetInstanceKey();
		master.ring = newMasterKeyring();
	});
	afterAll(async () => {
		await restoreCells();
		await resetInstanceKey();
	});
}
