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
import { type FieldAad, Keyring, sealField } from "~/server/crypto/field-crypto";
import { FIELD_MAP, keyClassOfColumn, modelOfTable } from "~/server/crypto/fields";
import { keystoreDb } from "~/server/db-core";
import { userTransaction } from "~/server/db-tx";
import { getOrCreateDataKeyring } from "~/server/services/keys/data-key.service";
import { getOrCreateInstanceKeyring } from "~/server/services/keys/instance-key.service";
import { adminDb } from "./pg-harness";

export const newMasterKeyring = () =>
	new Keyring([{ id: 1, key: randomBytes(32) }]);

/** The user's data keys, minted on first use. */
export const userKeyring = (userId: string, master: Keyring) =>
	userTransaction(keystoreDb, userId, (tx) => getOrCreateDataKeyring(tx, master));

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

/** Writes a raw value into one cell. */
export async function writeCell(
	table: string,
	column: string,
	rowId: string,
	value: string,
): Promise<void> {
	mappedCell(table, column);
	const count = await adminDb.$executeRawUnsafe(
		`UPDATE "${table}" SET "${column}" = $1 WHERE "id" = $2`,
		value,
		rowId,
	);
	if (count !== 1) throw new Error(`No ${table} row to seal`);
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
				? await userKeyring(row.userId as string, master)
				: await instanceKeyring(master);
		await sealCell(ring, { table, column, rowId }, value);
		plain[column] = value;
	}
	return plain;
}
