/**
 * What every pinned asset_account writer does to the version. The writer
 * inventory (accounts/asset-account-writers.ts, pinned against a search of the
 * repository by asset-account-writers.test.ts) is the source of truth: each
 * file in it must have at least one named case here, and a writer with no case
 * fails the first test. A case runs the real write on a fresh world and says by
 * how much each account's version moved (an account it leaves out must not
 * move at all).
 */
import { randomUUID } from "node:crypto";
import { CUSTOM_RATE_TYPE } from "@retrospend/domain/rate-booking";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { WRITERS } from "~/server/services/accounts/asset-account-writers";
import {
	restoreAccount,
	snapshotAccount,
} from "~/server/services/accounts/delete-snapshot";
import { setAccountIcon } from "~/server/services/accounts/icon";
import {
	closeAccount,
	deleteAccountIn,
	editAccount,
	reopenAccount,
} from "~/server/services/accounts/manage";
import {
	revertRateType,
	setRateType,
} from "~/server/services/accounts/rate-type.mutation";
import {
	arsUser,
	openAccount,
	seedArsRates,
} from "~/server/services/accounts/test-fixtures";
import {
	revertBalanceUpdate,
	updateBalance,
} from "~/server/services/accounts/update-balance.mutation";
import { setDebtTerms } from "~/server/services/envelope/debt.service";
import { addIncome } from "~/server/services/income/add.mutation";
import { moveIn } from "~/server/services/income/move-in.mutation";
import { forUser } from "~/server/services/preview";
import { createTransfer } from "~/server/services/transfers/create.mutation";
import { deleteTransfer } from "~/server/services/transfers/delete.mutation";
import { adminDb } from "~/test/pg-harness";

async function world() {
	const { user, db } = await arsUser();
	const userId = user.id;
	return {
		userId,
		db,
		run: forUser(userId),
		ars: await openAccount(userId, "Savings", "CASH", "ARS", 1_000_000),
		usdA: await openAccount(userId, "USD A", "INVESTMENT", "USD", 100, {
			exchangeRateType: "blue",
		}),
		usdB: await openAccount(userId, "USD B", "CASH", "USD", 0, {
			exchangeRateType: "blue",
		}),
		card: await openAccount(
			userId,
			"Card",
			"LIABILITY_CREDIT_CARD",
			"ARS",
			50_000,
		),
		// The custom rate matters for a currency other than USD (whose rate is 1):
		// 1 USD is 0.9 EUR.
		custom: await openAccount(userId, "Custom", "INVESTMENT", "EUR", 100, {
			exchangeRateType: CUSTOM_RATE_TYPE,
			exchangeRate: 0.9,
		}),
	};
}
type World = Awaited<ReturnType<typeof world>>;

const edited = {
	name: "USD A",
	type: "INVESTMENT",
	currency: "USD",
	balance: 100,
	exchangeRateType: "blue",
	isLiquid: false,
} as const;
const customFields = {
	...edited,
	name: "Custom",
	exchangeRateType: CUSTOM_RATE_TYPE,
	currency: "EUR",
	exchangeRate: 0.9,
} as const;

const exchangeRateOf = async (id: string) =>
	(
		await adminDb.assetAccount.findUniqueOrThrow({ where: { id } })
	).exchangeRate?.toString();

/** Account name to the number of versions it moved; a missing account moved none. */
type Moved = Partial<
	Record<keyof Omit<World, "userId" | "db" | "run">, number>
>;
type Case = { name: string; run: (w: World) => Promise<Moved> };

const stashAndDelete = (userId: string, id: string) =>
	userTransaction(adminDb, userId, async (tx) => {
		const snapshot = await snapshotAccount(tx, userId, id);
		await deleteAccountIn(tx, userId, id);
		return snapshot;
	});
const viaJson = <T>(v: T) => JSON.parse(JSON.stringify(v)) as T;

const usdIncome = (w: World) =>
	w.run.apply(addIncome, {
		title: "Estudio Norte",
		amount: "2000",
		currency: "USD",
		rateType: "mep",
		into: w.usdA,
	});

/** Every writer file of WRITERS, with the cases that show what it does to the version. */
const CASES: Record<string, readonly Case[]> = {
	"prisma/rollback/20261112100000_account_leg_half_even.sql": [
		{
			name: "the leg trigger it restores moves balance only: an income leg",
			run: async (w) => {
				await usdIncome(w);
				return {};
			},
		},
	],
	"src/server/services/accounts/manage.ts": [
		{
			name: "edit moves it by 1",
			run: async (w) => {
				await editAccount(adminDb, w.userId, w.usdA, {
					...edited,
					isLiquid: true,
				});
				return { usdA: 1 };
			},
		},
		{
			name: "a custom rate typed through edit moves it by 1",
			run: async (w) => {
				await editAccount(adminDb, w.userId, w.custom, {
					...customFields,
					exchangeRate: 0.95,
				});
				return { custom: 1 };
			},
		},
		{
			name: "an edit that changes nothing moves nothing",
			run: async (w) => {
				await editAccount(adminDb, w.userId, w.usdA, edited);
				return {};
			},
		},
		{
			name: "close then reopen moves it by 1 each",
			run: async (w) => {
				await closeAccount(adminDb, w.userId, w.usdA);
				await reopenAccount(adminDb, w.userId, w.usdA);
				return { usdA: 2 };
			},
		},
		{
			name: "the delete takes the row and no neighbour's version",
			run: async (w) => {
				await stashAndDelete(w.userId, w.usdB);
				return {};
			},
		},
	],
	"src/server/services/accounts/checkpoint.ts": [
		{
			name: "a balance update that keeps the rate type moves nothing",
			run: async (w) => {
				await w.run.apply(updateBalance, { accountId: w.usdA, balance: "120" });
				return {};
			},
		},
		{
			name: "a checkpoint that refreshes a stale cached table rate moves nothing",
			run: async (w) => {
				await adminDb.assetAccount.update({
					where: { id: w.ars },
					data: { exchangeRate: "1" },
				});
				await w.run.apply(updateBalance, {
					accountId: w.ars,
					balance: "1000100",
				});
				expect(await exchangeRateOf(w.ars)).not.toBe("1");
				return {};
			},
		},
		{
			name: "a checkpoint on a custom account with the same rate moves nothing",
			run: async (w) => {
				await w.run.apply(updateBalance, {
					accountId: w.custom,
					balance: "150",
				});
				expect(await exchangeRateOf(w.custom)).toBe("0.9");
				return {};
			},
		},
		{
			name: "a balance update that types a new custom rate moves it by 1",
			run: async (w) => {
				await w.run.apply(updateBalance, {
					accountId: w.custom,
					balance: "150",
					rateType: CUSTOM_RATE_TYPE,
					exchangeRate: 0.85,
				});
				expect(await exchangeRateOf(w.custom)).toBe("0.85");
				return { custom: 1 };
			},
		},
	],
	"src/server/services/accounts/rate-type.mutation.ts": [
		{
			name: "a rate type switch moves it by 1",
			run: async (w) => {
				await w.run.apply(setRateType, {
					accountId: w.usdA,
					rateType: "official",
				});
				return { usdA: 1 };
			},
		},
		{
			name: "taking the switch back moves it again",
			run: async (w) => {
				const set = await w.run.apply(setRateType, {
					accountId: w.usdA,
					rateType: "official",
				});
				await w.run.apply(revertRateType, {
					rateTypeId: set.value.rateTypeId,
				});
				return { usdA: 2 };
			},
		},
	],
	"src/server/services/accounts/update-balance.mutation.ts": [
		{
			name: "taking back a balance update moves nothing",
			run: async (w) => {
				const done = await w.run.apply(updateBalance, {
					accountId: w.usdA,
					balance: "130",
				});
				await w.run.apply(revertBalanceUpdate, {
					accountId: w.usdA,
					legId: done.value.legId,
					rateTypeId: null,
					previousRate: done.value.previousRate,
				});
				return {};
			},
		},
		{
			name: "taking back an update that switched the rate type moves it back too",
			run: async (w) => {
				const done = await w.run.apply(updateBalance, {
					accountId: w.usdA,
					balance: "130",
					rateType: "official",
				});
				await w.run.apply(revertBalanceUpdate, {
					accountId: w.usdA,
					legId: done.value.legId,
					rateTypeId: done.value.rateSwitch?.rateTypeId ?? null,
					previousRate: done.value.previousRate,
				});
				return { usdA: 2 };
			},
		},
	],
	"src/server/services/accounts/icon.ts": [
		{
			name: "an icon swap moves nothing",
			run: async (w) => {
				await setAccountIcon(adminDb, w.userId, w.usdA, {
					kind: "MONOGRAM",
					value: "avatar-3",
				});
				return {};
			},
		},
	],
	"src/server/services/accounts/delete-snapshot.ts": [
		{
			name: "a restore keeps the version the stash holds",
			run: async (w) => {
				await editAccount(adminDb, w.userId, w.usdA, {
					...edited,
					isLiquid: true,
				});
				const stash = viaJson(await stashAndDelete(w.userId, w.usdA));
				await userTransaction(adminDb, w.userId, (tx) =>
					restoreAccount(tx, w.userId, stash),
				);
				return { usdA: 1 };
			},
		},
		{
			name: "a stash from before the column is bumped after the restore",
			run: async (w) => {
				const stash = viaJson(await stashAndDelete(w.userId, w.usdA));
				const { version: _gone, ...old } = stash.account as Record<
					string,
					unknown
				>;
				await userTransaction(adminDb, w.userId, (tx) =>
					restoreAccount(tx, w.userId, { ...stash, account: old }),
				);
				return { usdA: 1 };
			},
		},
	],
	"src/server/services/envelope/debt.service.ts": [
		{
			name: "setDebtTerms (interest, minimum, due day) moves it by 1",
			run: async (w) => {
				await userTransaction(adminDb, w.userId, (tx) =>
					setDebtTerms(tx, {
						assetAccountId: w.card,
						aprPercent: "24",
						minimumMinor: 500_000,
						dueDay: 5,
					}),
				);
				return { card: 1 };
			},
		},
	],
	"src/server/services/income/move-in.mutation.ts": [
		{
			name: "a Move in counts units and moves nothing",
			run: async (w) => {
				const income = await usdIncome(w);
				await w.run.apply(moveIn, { expenseId: income.value.expenseId });
				return {};
			},
		},
		{
			name: "a Move in of wealth money (counted units on the account) moves nothing",
			run: async (w) => {
				await w.run.apply(moveIn, {
					id: randomUUID(),
					accountId: w.usdA,
					units: "10",
				});
				return {};
			},
		},
	],
	"src/server/services/transfers/create.mutation.ts": [
		{
			name: "a counted move between two accounts moves neither version",
			run: async (w) => {
				await adminDb.assetAccount.update({
					where: { id: w.usdA },
					data: { countedUnits: "60" },
				});
				await w.run.apply(createTransfer, {
					fromAccountId: w.usdA,
					toAccountId: w.usdB,
					fromAmount: "40",
				});
				return {};
			},
		},
	],
	"src/server/services/transfers/delete.mutation.ts": [
		{
			name: "deleting a counted move gives the units back and moves neither version",
			run: async (w) => {
				await adminDb.assetAccount.update({
					where: { id: w.usdA },
					data: { countedUnits: "60" },
				});
				const made = await w.run.apply(createTransfer, {
					fromAccountId: w.usdA,
					toAccountId: w.usdB,
					fromAmount: "40",
				});
				await w.run.apply(deleteTransfer, {
					transferId: made.value.transferId,
				});
				return {};
			},
		},
	],
};

const versions = async (w: World) => {
	const ids = {
		ars: w.ars,
		usdA: w.usdA,
		usdB: w.usdB,
		card: w.card,
		custom: w.custom,
	};
	const rows = await adminDb.assetAccount.findMany({
		where: { id: { in: Object.values(ids) } },
		select: { id: true, version: true },
	});
	const byId = new Map(rows.map((r) => [r.id, r.version]));
	return Object.fromEntries(
		Object.entries(ids).map(([name, id]) => [name, byId.get(id)]),
	) as Record<string, number | undefined>;
};

describe("every asset_account writer has a version case", () => {
	it("the cases are exactly the pinned writers, each with at least one", () => {
		expect(Object.keys(CASES).sort()).toEqual(Object.keys(WRITERS).sort());
		for (const [file, cases] of Object.entries(CASES))
			expect(cases.length, file).toBeGreaterThan(0);
	});

	beforeAll(seedArsRates);

	for (const [file, cases] of Object.entries(CASES)) {
		describe(file, () => {
			for (const c of cases) {
				it(c.name, async () => {
					const w = await world();
					const before = await versions(w);
					const expected = await c.run(w);
					const after = await versions(w);
					for (const name of Object.keys(before)) {
						if (after[name] === undefined) continue;
						expect(
							(after[name] ?? 0) - (before[name] ?? 0),
							`${name} after "${c.name}"`,
						).toBe(expected[name as keyof Moved] ?? 0);
					}
				});
			}
		});
	}
});
