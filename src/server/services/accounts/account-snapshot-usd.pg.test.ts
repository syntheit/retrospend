/**
 * A balance update's USD value is written rounded half to even, as the account
 * leg trigger rounds it (20261112100000_account_leg_half_even): creating an
 * account, reopening it, Update balance and its undo all go through
 * WealthService.recordAssetSnapshot, which rounds before Postgres can (the
 * numeric(12,2) cast rounds half away from zero). Expected values are derived
 * by hand: custom rates make exact ties, the ARS Blue table rate (1,468 per
 * USD, test-fixtures) a plain conversion. A missing rate is never a USD value
 * of 0.
 */
import { MissingRateError } from "@retrospend/domain/money";
import { beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "~/server/api/trpc";
import { forUser } from "~/server/services/preview";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import type { AssetType } from "~prisma";
import { wealthRouter } from "../../api/routers/wealth";
import { closeAccount, createAccount, reopenAccount } from "./manage";
import { arsUser, seedArsRates, TODAY_ZONE } from "./test-fixtures";
import { revertBalanceUpdate, updateBalance } from "./update-balance.mutation";

let userId: string;

beforeAll(async () => {
	await seedArsRates();
	userId = (await arsUser()).user.id;
});

async function open(
	currency: string,
	balance: number,
	rate: number | null,
	type: AssetType = "CASH",
) {
	const account = await createAccount(
		adminDb,
		userId,
		{
			name: `${currency} ${balance}`,
			type,
			currency,
			balance,
			isLiquid: true,
			...(rate === null
				? { exchangeRateType: "blue" }
				: { exchangeRateType: "custom", exchangeRate: rate }),
		},
		TODAY_ZONE,
	);
	return account.id;
}

/** "balance / balanceInUSD" of the snapshot written last. */
async function latest(accountId: string) {
	const row = await adminDb.assetSnapshot.findFirstOrThrow({
		where: { accountId },
		orderBy: { recordedAt: "desc" },
	});
	return `${row.balance.toFixed()} / ${row.balanceInUSD.toFixed(2)}`;
}

describe("a new account's first balance update", () => {
	it("rounds an ARS tie to even, either sign", async () => {
		// 25 / 1000 = 0.025 to 0.02 (the cast gave 0.03); 15 / 1000 = 0.015 to
		// 0.02; -25 / 1000 = -0.025 to -0.02 (the cast gave -0.03).
		expect(await latest(await open("ARS", 25, 1000))).toBe("25 / 0.02");
		expect(await latest(await open("ARS", 15, 1000))).toBe("15 / 0.02");
		expect(await latest(await open("ARS", -25, 1000))).toBe("-25 / -0.02");
	});

	it("values ARS at the Blue table rate", async () => {
		// 1000 / 1468 = 0.6811989...; 734 / 1468 = 0.5 exactly.
		const id = await open("ARS", 1000, null);
		expect(await latest(id)).toBe("1000 / 0.68");
		expect(await latest(await open("ARS", 734, null))).toBe("734 / 0.50");
		const row = await fixtureDb.assetAccount.findUniqueOrThrow({
			where: { id },
		});
		expect(row.balance.toFixed()).toBe("1000");
	});

	it("rounds JPY, KWD and crypto ties to even", async () => {
		// 1 JPY at 200 = 0.005 to 0.00; 0.005 KWD at 0.2 = 0.025 to 0.02;
		// 0.003 KWD at 0.2 = 0.015 to 0.02; 0.0001 BTC x 50 = 0.005 to 0.00;
		// 0.0003 BTC x 50 = 0.015 to 0.02.
		expect(await latest(await open("JPY", 1, 200))).toBe("1 / 0.00");
		expect(await latest(await open("KWD", 0.005, 0.2))).toBe("0.005 / 0.02");
		expect(await latest(await open("KWD", 0.003, 0.2))).toBe("0.003 / 0.02");
		expect(await latest(await open("BTC", 0.0001, 50, "CRYPTO"))).toBe(
			"0.0001 / 0.00",
		);
		expect(await latest(await open("BTC", 0.0003, 50, "CRYPTO"))).toBe(
			"0.0003 / 0.02",
		);
	});
});

describe("reopening an account", () => {
	it("values today's balance half to even", async () => {
		const id = await open("ARS", 25, 1000);
		await closeAccount(adminDb, userId, id);
		expect(await latest(id)).toBe("0 / 0.00");
		await reopenAccount(adminDb, userId, id);
		// 25 / 1000 = 0.025 to 0.02.
		expect(await latest(id)).toBe("25 / 0.02");
	});

	it("with no rate at all throws MissingRateError and writes nothing", async () => {
		// XYZ has no table rate; its typed rate is then taken away.
		const id = await open("XYZ", 5, 10);
		await fixtureDb.assetAccount.update({
			where: { id },
			data: { exchangeRate: null, exchangeRateType: null },
		});
		await closeAccount(adminDb, userId, id);

		await expect(reopenAccount(adminDb, userId, id)).rejects.toBeInstanceOf(
			MissingRateError,
		);
		const row = await fixtureDb.assetAccount.findUniqueOrThrow({
			where: { id },
		});
		expect(row.closedAt).not.toBeNull();
		expect(await latest(id)).toBe("0 / 0.00");
	});

	it("with a balance of exactly 0 needs no rate: 0 of anything is 0 USD", async () => {
		const id = await open("XYZ", 0, 10);
		await fixtureDb.assetAccount.update({
			where: { id },
			data: { exchangeRate: null, exchangeRateType: null },
		});
		await closeAccount(adminDb, userId, id);

		await reopenAccount(adminDb, userId, id);

		const row = await fixtureDb.assetAccount.findUniqueOrThrow({
			where: { id },
		});
		expect(row.closedAt).toBeNull();
		expect(await latest(id)).toBe("0 / 0.00");
	});

	it("tells the user through the router as a bad request, not a crash", async () => {
		const id = await open("XYZ", 5, 10);
		await fixtureDb.assetAccount.update({
			where: { id },
			data: { exchangeRate: null, exchangeRateType: null },
		});
		await closeAccount(adminDb, userId, id);
		const caller = createCallerFactory(wealthRouter)({
			session: makeSession({ id: userId }),
			db: adminDb,
			headers: new Headers(),
		});

		await expect(caller.reopenAsset({ id })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});
});

describe("Update balance and its undo", () => {
	it("round the new and the restored USD value half to even", async () => {
		const id = await open("ARS", 25, 1000);
		const { value } = await forUser(userId).apply(updateBalance, {
			accountId: id,
			balance: "45",
		});
		// 45 / 1000 = 0.045 to 0.04 (the cast gave 0.05).
		expect(await latest(id)).toBe("45 / 0.04");

		await forUser(userId).apply(revertBalanceUpdate, {
			accountId: id,
			legId: value.legId,
			rateTypeId: null,
		});
		// Back to 25 at the stored 1000: 0.025 to 0.02.
		expect(await latest(id)).toBe("25 / 0.02");
	});
});
