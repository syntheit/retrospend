/**
 * M6 PR0: when asset_account.updatedAt moves today. It is the "Updated" date
 * on screen (web view-model, phone account rows), so M6 must keep every row
 * of this table: Prisma's @updatedAt moves it on every client update, the
 * leg trigger and raw SQL do not, and the icon swap and the restore pin it.
 * The clock is pinned and stepped by days so each write has its own instant.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { addIncome } from "~/server/services/income/add.mutation";
import { forUser } from "~/server/services/preview";
import { createTransfer } from "~/server/services/transfers/create.mutation";
import { deleteTransfer } from "~/server/services/transfers/delete.mutation";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import {
	BUENOS_AIRES,
	PIN_INSTANT,
	seedCharacterizationRates,
	userIn,
} from "./characterization-fixtures";
import { setAccountIcon } from "./icon";
import { closeAccount, editAccount, reopenAccount } from "./manage";
import { setRateType } from "./rate-type.mutation";
import { balanceOf, openAccount } from "./test-fixtures";
import { updateBalance } from "./update-balance.mutation";

const T0 = PIN_INSTANT;
const at = (days: number) => new Date(T0.getTime() + days * 86_400_000);
const stamp = async (id: string) =>
	(await fixtureDb.assetAccount.findUniqueOrThrow({ where: { id } })).updatedAt;

let dropRates: () => Promise<unknown>;
beforeAll(async () => {
	dropRates = await seedCharacterizationRates();
});
afterAll(() => dropRates());
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: T0 });
});
afterEach(() => {
	vi.useRealTimers();
});

async function world() {
	const { user } = await userIn(BUENOS_AIRES);
	const id = user.id;
	return {
		userId: id,
		savings: await openAccount(id, "Savings", "CASH", "ARS", 5_000_000),
		wallet: await openAccount(id, "Wallet", "CASH", "ARS", 1_000_000),
		usdA: await openAccount(id, "USD A", "INVESTMENT", "USD", 100, {
			exchangeRateType: "blue",
		}),
		usdB: await openAccount(id, "USD B", "CASH", "USD", 0, {
			exchangeRateType: "blue",
		}),
	};
}

describe("writes that keep updatedAt", () => {
	it("the icon swap, an income leg and a plain transfer leave it, while the balance moves", async () => {
		const w = await world();
		vi.setSystemTime(at(1));
		await setAccountIcon(adminDb, w.userId, w.savings, {
			kind: "MONOGRAM",
			value: "avatar-3",
		});
		await forUser(w.userId).apply(addIncome, {
			title: "Salary",
			amount: "1000",
			currency: "ARS",
			into: w.savings,
		});
		await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.savings,
			toAccountId: w.wallet,
			fromAmount: "500",
		});

		const row = await fixtureDb.assetAccount.findUniqueOrThrow({
			where: { id: w.savings },
		});
		expect(row.iconKind).toBe("MONOGRAM");
		expect(row.balance.toString()).toBe("5000500");
		expect(row.updatedAt).toEqual(T0);
		expect(await balanceOf(w.wallet)).toBe("1000500");
		expect(await stamp(w.wallet)).toEqual(T0);
	});
});

describe("writes that move updatedAt", () => {
	it("a counted move between two places outside the budget moves both; its delete moves only the source", async () => {
		const w = await world();
		await adminDb.assetAccount.update({
			where: { id: w.usdA },
			data: { countedUnits: "60" },
		});
		vi.setSystemTime(at(1));
		const made = await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.usdA,
			toAccountId: w.usdB,
			fromAmount: "40",
		});
		expect(await stamp(w.usdA)).toEqual(at(1));
		expect(await stamp(w.usdB)).toEqual(at(1));

		vi.setSystemTime(at(2));
		await forUser(w.userId).apply(deleteTransfer, {
			transferId: made.value.transferId,
		});
		// The source's counted units come back through a client update; the
		// destination's are taken in raw SQL, which leaves the stamp alone.
		expect(await stamp(w.usdA)).toEqual(at(2));
		expect(await stamp(w.usdB)).toEqual(at(1));
	});

	it("a move with no counted units moves neither account's stamp", async () => {
		const w = await world();
		vi.setSystemTime(at(1));
		await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.usdA,
			toAccountId: w.usdB,
			fromAmount: "40",
		});
		expect(await stamp(w.usdA)).toEqual(T0);
		expect(await stamp(w.usdB)).toEqual(T0);
	});

	it("update balance (the checkpoint), close, reopen, a rate switch and an edit each move it", async () => {
		const w = await world();
		const run = forUser(w.userId);
		vi.setSystemTime(at(1));
		await run.apply(updateBalance, { accountId: w.usdA, balance: "120" });
		expect(await stamp(w.usdA)).toEqual(at(1));

		vi.setSystemTime(at(2));
		await closeAccount(adminDb, w.userId, w.usdA);
		expect(await stamp(w.usdA)).toEqual(at(2));

		vi.setSystemTime(at(3));
		await reopenAccount(adminDb, w.userId, w.usdA);
		expect(await stamp(w.usdA)).toEqual(at(3));

		vi.setSystemTime(at(4));
		await run.apply(setRateType, { accountId: w.usdA, rateType: "official" });
		expect(await stamp(w.usdA)).toEqual(at(4));

		vi.setSystemTime(at(5));
		await editAccount(adminDb, w.userId, w.usdA, {
			name: "USD A",
			type: "INVESTMENT",
			currency: "USD",
			balance: 120,
			exchangeRateType: "official",
			isLiquid: false,
		});
		expect(await stamp(w.usdA)).toEqual(at(5));
	});
});
