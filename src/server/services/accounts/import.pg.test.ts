/**
 * importAccounts finds an open account by name in the app layer (E2EE lane
 * D10), since a name may be ciphertext. The old version asked Postgres with
 * `where name = ...`; it is copied below as the oracle and both run over the
 * same rows for two users, which must end with the same accounts: an open
 * account of that name is edited, a closed one is left alone and a new one is
 * made, a name that repeats inside the file finds the account the first row
 * made, and a row that fails counts as an error.
 */
import { describe, expect, it } from "vitest";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import {
	type ImportRow,
	closeAccount,
	createAccount,
	editAccount,
	importAccounts,
} from "./manage";
import { TODAY_ZONE, arsUser } from "./test-fixtures";

async function oldImportAccounts(userId: string, rows: readonly ImportRow[]) {
	let successCount = 0;
	let errorCount = 0;
	for (const row of rows) {
		try {
			const existing = await fixtureDb.assetAccount.findFirst({
				where: { userId, name: row.name, closedAt: null },
			});
			if (existing)
				await editAccount(adminDb, userId, existing.id, row, TODAY_ZONE);
			else await createAccount(adminDb, userId, row, TODAY_ZONE);
			successCount++;
		} catch {
			errorCount++;
		}
	}
	return { successCount, errorCount };
}

const row = (
	name: string,
	balance: number,
	extra: Partial<ImportRow> = {},
): ImportRow => ({
	name,
	type: "CASH",
	currency: "USD",
	balance,
	isLiquid: true,
	...extra,
});

async function seed(userId: string) {
	await createAccount(adminDb, userId, row("Savings", 100), TODAY_ZONE);
	const old = await createAccount(adminDb, userId, row("Old", 50), TODAY_ZONE);
	await closeAccount(adminDb, userId, old.id);
}

const ROWS: ImportRow[] = [
	row("Savings", 250),
	row("Old", 75),
	row("Brand new", 10),
	row("Brand new", 20),
	row("Ñandú fund", 5),
	// A currency with no rate fails, and does not stop the rows after it.
	row("No rate", 1, { currency: "ZZZ" }),
	row("After the failure", 3),
];

async function snapshot(userId: string) {
	const accounts = await fixtureDb.assetAccount.findMany({
		where: { userId },
		select: { name: true, balance: true, closedAt: true },
	});
	return accounts
		.map(
			(a) =>
				`${a.name}|${a.balance.toString()}|${a.closedAt ? "closed" : "open"}`,
		)
		.sort();
}

describe("importAccounts", () => {
	it("ends with the same accounts and counts as the old lookup by name", async () => {
		const [a, b] = [await arsUser(), await arsUser()];
		await seed(a.user.id);
		await seed(b.user.id);

		// As the router calls it: on the user's own client.
		const got = await importAccounts(a.db, a.user.id, ROWS, TODAY_ZONE);
		const expected = await oldImportAccounts(b.user.id, ROWS);

		expect(got).toEqual(expected);
		expect(got).toEqual({ successCount: 6, errorCount: 1 });
		expect(await snapshot(a.user.id)).toEqual(await snapshot(b.user.id));
		// Hand-derived: Savings edited to 250, the closed Old kept and a new Old
		// opened, Brand new made once and edited to 20.
		expect(await snapshot(a.user.id)).toEqual(
			[
				"After the failure|3|open",
				"Brand new|20|open",
				"Old|50|closed",
				"Old|75|open",
				"Savings|250|open",
				"Ñandú fund|5|open",
			].sort(),
		);
	});
});
