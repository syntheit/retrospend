/**
 * A transfer's fee charged to an account in a third currency (neither side's):
 * it is valued at the day's rate like the legs (a fee no rate values is covered
 * in the domain's rows.test.ts). ARS home, Blue 1 USD = 1,545 ARS,
 * clock pinned (accounts/characterization-fixtures.ts). Currency QQQ is
 * priced here only: 0.9 QQQ per USD on Feb 20, while its account still holds
 * a stale stored rate of 0.5.
 *
 * Hand-derived: QQQ 9.00 / 0.9 = USD 10.00 x ARS 1,545 = ARS 15,450.00, so the
 * fee leg books -15,450 and net worth moves -15,450.00 (minor -1,545,000). At
 * the stale stored rate it would be 9 / 0.5 = USD 18 = ARS 27,810.
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
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import {
	BUENOS_AIRES,
	PIN_INSTANT,
	seedCharacterizationRates,
	userIn,
} from "../accounts/characterization-fixtures";
import { openAccount } from "../accounts/test-fixtures";
import { createTransfer } from "./create.mutation";

const RATE_DAY = new Date("2026-02-20T00:00:00Z");
let dropRates: () => Promise<unknown>;
beforeAll(async () => {
	dropRates = await seedCharacterizationRates();
});
afterAll(() => dropRates());
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: PIN_INSTANT });
});
afterEach(async () => {
	vi.useRealTimers();
	await adminDb.exchangeRate.deleteMany({ where: { currency: "QQQ" } });
});

async function world() {
	await adminDb.exchangeRate.create({
		data: { date: RATE_DAY, currency: "QQQ", type: "official", rate: "0.9" },
	});
	const { user } = await userIn(BUENOS_AIRES);
	const qqq = await openAccount(user.id, "QQQ cash", "CASH", "QQQ", 1000);
	await adminDb.assetAccount.update({
		where: { id: qqq },
		data: { exchangeRate: "0.5" },
	});
	return {
		userId: user.id,
		savings: await openAccount(user.id, "Savings", "CASH", "ARS", 5_000_000),
		wallet: await openAccount(user.id, "Wallet", "CASH", "ARS", 1_000_000),
		qqq,
	};
}

describe("a fee charged to an account in a third currency", () => {
	it("is valued at the day's rate, not the account's stored one", async () => {
		const w = await world();
		const r = await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.savings,
			toAccountId: w.wallet,
			fromAmount: "300000",
			fee: { amount: "9", accountId: w.qqq },
		});
		const feeLeg = await adminDb.accountLeg.findFirstOrThrow({
			where: { transferId: r.value.transferId, source: "FEE" },
		});
		expect(feeLeg.amount.toString()).toBe("-9");
		expect(feeLeg.homeAmount?.toString()).toBe("-15450");
		expect(r.value.netWorthEffect).toEqual({
			minor: -1_545_000,
			currency: "ARS",
		});
	});
});
