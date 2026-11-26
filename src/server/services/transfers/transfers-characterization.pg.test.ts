/**
 * M6 PR0: transfer create and delete exactly as they behave today, so the
 * device twin (M6b) can prove it changed nothing. Rows, legs, balances,
 * counted units, the fee expense and its FEE leg, the figures a preview
 * names, every refusal, and undo both ways. ARS home, Blue 1 USD = 1,545
 * ARS, Official 1,050 (accounts/characterization-fixtures.ts), clock pinned.
 *
 * Hand-derived vectors:
 * - ARS 1,545,000.00 into a USD account with no typed amount arrives at the
 *   reference rate, the default pick of both currencies (Blue):
 *   1,545,000 / 1,545 = USD 1,000.00. Valued at Blue the leg books ARS
 *   1,545,000, so net worth does not move.
 * - Into a USD account whose rate type is Official the arrived units are
 *   still USD 1,000.00 (the reference ignores the account's type), but the
 *   leg is booked at the account's own type: 1,000 x 1,050 = ARS 1,050,000.
 *   Net worth moves by 1,050,000 - 1,545,000 = ARS -495,000.
 * - Typed arrival USD 1,471.43 (1,545,000 / 1,050 = 1,471.428571..., which
 *   half-even rounds to cents at 1,471.43): the leg books 1,471.43 x 1,050 =
 *   ARS 1,545,001.50, so net worth moves by +ARS 1.50.
 */
import { randomUUID } from "node:crypto";
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
import { createCallerFactory } from "~/server/api/trpc";
import { forUser } from "~/server/services/preview";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { wealthRouter } from "../../api/routers/wealth";
import {
	BUENOS_AIRES,
	MAR_10,
	PIN_INSTANT,
	seedCharacterizationRates,
	userIn,
} from "../accounts/characterization-fixtures";
import { closeAccount } from "../accounts/manage";
import { balanceOf, openAccount } from "../accounts/test-fixtures";
import { type CreateTransferInput, createTransfer } from "./create.mutation";
import { deleteTransfer } from "./delete.mutation";

let dropRates: () => Promise<unknown>;
beforeAll(async () => {
	dropRates = await seedCharacterizationRates();
});
afterAll(() => dropRates());
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: PIN_INSTANT });
});
afterEach(() => {
	vi.useRealTimers();
});

const ARS = (minor: number) => ({ minor, currency: "ARS" });

async function world() {
	const { user } = await userIn(BUENOS_AIRES);
	const id = user.id;
	return {
		userId: id,
		savings: await openAccount(id, "Savings", "CASH", "ARS", 5_000_000),
		wallet: await openAccount(id, "Wallet", "CASH", "ARS", 1_000_000),
		card: await openAccount(
			id,
			"Card",
			"LIABILITY_CREDIT_CARD",
			"ARS",
			842_600,
		),
		usdBlue: await openAccount(id, "USD at Blue", "CASH", "USD", 0, {
			exchangeRateType: "blue",
		}),
		usdOfficial: await openAccount(
			id,
			"USD at Official",
			"INVESTMENT",
			"USD",
			0,
			{
				exchangeRateType: "official",
			},
		),
	};
}
type World = Awaited<ReturnType<typeof world>>;

const legsOf = (transferId: string) =>
	adminDb.accountLeg.findMany({
		where: { transferId },
		orderBy: [{ source: "asc" }, { amount: "asc" }],
	});
const leg = (l: Awaited<ReturnType<typeof legsOf>>[number]) => ({
	accountId: l.accountId,
	source: l.source,
	amount: l.amount.toString(),
	home: l.homeAmount?.toString() ?? null,
	homeCurrency: l.homeCurrency,
	counted: l.countedUnits.toString(),
	date: l.date,
	expenseId: l.expenseId,
});
const counts = (userId: string) =>
	Promise.all([
		adminDb.transfer.count({ where: { userId } }),
		adminDb.accountLeg.count({ where: { userId } }),
		fixtureDb.expense.count({ where: { userId } }),
	]);
const delta = (
	r: { changes: readonly { id: string; delta: unknown }[] },
	id: string,
) => r.changes.find((c) => c.id === id)?.delta;
const ids = (list: readonly { id: string }[]) => list.map((x) => x.id).sort();

describe("transfer.create: rows, legs and balances", () => {
	it("an exchange with no typed amount arrives at the Blue reference", async () => {
		const w = await world();
		const r = await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.savings,
			toAccountId: w.usdBlue,
			fromAmount: "1545000",
		});

		expect(r.value).toMatchObject({
			kind: "EXCHANGE",
			fromAmount: "1545000",
			fromCurrency: "ARS",
			toAmount: "1000",
			toCurrency: "USD",
			rate: { base: "USD", quote: "ARS", value: "1545.000000" },
			vsReference: ARS(0),
			referenceRateType: "blue",
			referenceRate: { base: "USD", quote: "ARS", value: "1545.000000" },
			netWorthEffect: ARS(0),
			feeExpenseId: null,
			budget: {
				effect: "leaves",
				minor: 154_500_000,
				currency: "ARS",
				side: { recorded: false, reason: "no_envelope_budget" },
			},
		});
		expect(await balanceOf(w.savings)).toBe("3455000");
		expect(await balanceOf(w.usdBlue)).toBe("1000");
		const row = await fixtureDb.transfer.findUniqueOrThrow({
			where: { id: r.value.transferId },
		});
		expect(row).toMatchObject({
			kind: "EXCHANGE",
			date: MAR_10,
			fromAccountId: w.savings,
			toAccountId: w.usdBlue,
			fromCurrency: "ARS",
			toCurrency: "USD",
			referenceRateType: "blue",
			feeExpenseId: null,
			note: null,
		});
		expect([row.fromAmount.toString(), row.toAmount.toString()]).toEqual([
			"1545000",
			"1000",
		]);
		expect(
			[row.countedFromUnits, row.countedToUnits].map((d) => d.toString()),
		).toEqual(["0", "0"]);
		expect((await legsOf(r.value.transferId)).map(leg)).toEqual([
			{
				accountId: w.savings,
				source: "TRANSFER",
				amount: "-1545000",
				home: "-1545000",
				homeCurrency: "ARS",
				counted: "0",
				date: MAR_10,
				expenseId: null,
			},
			{
				accountId: w.usdBlue,
				source: "TRANSFER",
				amount: "1000",
				home: "1545000",
				homeCurrency: "ARS",
				counted: "0",
				date: MAR_10,
				expenseId: null,
			},
		]);
		expect(r.unchanged.map((u) => u.id)).toContain("netWorth");
	});

	it("into an Official account the units are the same and the leg is booked at Official", async () => {
		const w = await world();
		const r = await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.savings,
			toAccountId: w.usdOfficial,
			fromAmount: "1545000",
		});

		expect(r.value).toMatchObject({
			toAmount: "1000",
			vsReference: ARS(0),
			netWorthEffect: ARS(-49_500_000),
		});
		expect(delta(r, "netWorth")).toEqual(ARS(-49_500_000));
		expect(await balanceOf(w.usdOfficial)).toBe("1000");
		const legs = (await legsOf(r.value.transferId)).map(leg);
		expect(legs.find((l) => l.accountId === w.usdOfficial)?.home).toBe(
			"1050000",
		);
		expect(legs.find((l) => l.accountId === w.savings)?.home).toBe("-1545000");
	});

	it("a typed arrival of USD 1,471.43 at Official books ARS 1,545,001.50", async () => {
		const w = await world();
		const r = await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.savings,
			toAccountId: w.usdOfficial,
			fromAmount: "1545000",
			toAmount: "1471.43",
		});

		expect(r.value.toAmount).toBe("1471.43");
		expect(r.value.netWorthEffect).toEqual(ARS(150));
		expect(await balanceOf(w.usdOfficial)).toBe("1471.43");
		const to = (await legsOf(r.value.transferId))
			.map(leg)
			.find((l) => l.accountId === w.usdOfficial);
		expect(to?.home).toBe("1545001.5");
		// What the typed amount implies: 1,545,000 / 1,471.43.
		expect(r.value.rate).toEqual({
			base: "USD",
			quote: "ARS",
			value: "1049.998981",
		});
	});

	it("a card payment and a same-side move keep their kind and leave the budget alone", async () => {
		const w = await world();
		const run = forUser(w.userId);
		const pay = await run.apply(createTransfer, {
			fromAccountId: w.savings,
			toAccountId: w.card,
			fromAmount: "100000",
		});
		const same = await run.apply(createTransfer, {
			fromAccountId: w.savings,
			toAccountId: w.wallet,
			fromAmount: "50000.50",
		});
		expect(pay.value.kind).toBe("CARD_PAYMENT");
		expect(pay.value.budget).toMatchObject({ effect: "none" });
		expect(same.value.budget.effect).toBe("none");
		expect(await balanceOf(w.card)).toBe("742600");
		expect(await balanceOf(w.wallet)).toBe("1050000.5");
		expect(await balanceOf(w.savings)).toBe("4849999.5");
	});
});

describe("transfer.create: the fee", () => {
	const fee = { amount: "1500" };

	it("is an expense titled Fee with a FEE leg, and it is the only spending", async () => {
		const w = await world();
		const r = await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.savings,
			toAccountId: w.wallet,
			fromAmount: "300000",
			fee,
		});

		expect(r.value.feeExpenseId).toEqual(expect.any(String));
		expect(r.value.netWorthEffect).toEqual(ARS(-150_000));
		expect(delta(r, "spent")).toEqual(ARS(150_000));
		expect(delta(r, "netWorth")).toEqual(ARS(-150_000));
		expect(await balanceOf(w.savings)).toBe("4698500");
		expect(await balanceOf(w.wallet)).toBe("1300000");

		const expense = await fixtureDb.expense.findUniqueOrThrow({
			where: { id: r.value.feeExpenseId ?? "" },
		});
		expect(expense).toMatchObject({
			title: "Fee",
			description: "Fee for a transfer",
			currency: "ARS",
			// An expense row is dated at the zone's midnight (rowDateOf).
			date: new Date("2026-03-10T03:00:00Z"),
		});
		expect(expense.amount.toString()).toBe("1500");
		const transfer = await fixtureDb.transfer.findUniqueOrThrow({
			where: { id: r.value.transferId },
		});
		expect(transfer.feeExpenseId).toBe(expense.id);
		const legs = (await legsOf(r.value.transferId)).map(leg);
		expect(legs).toContainEqual({
			accountId: w.savings,
			source: "FEE",
			amount: "-1500",
			home: "-1500",
			homeCurrency: "ARS",
			counted: "0",
			date: MAR_10,
			expenseId: expense.id,
		});
		expect(legs).toHaveLength(3);
		// One change row per account: before the move, after the fee.
		expect(
			r.value.accounts.find((a) => a.accountId === w.savings),
		).toMatchObject({ before: "5000000", after: "4698500" });
	});

	it("can be charged to another account of the user", async () => {
		const w = await world();
		const r = await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.savings,
			toAccountId: w.wallet,
			fromAmount: "300000",
			fee: { amount: "1500", accountId: w.card },
		});
		// Owing more on a card is less of yours: the card's balance goes up.
		expect(await balanceOf(w.card)).toBe("844100");
		expect(await balanceOf(w.savings)).toBe("4700000");
		expect(r.value.accounts.map((a) => a.accountId).sort()).toEqual(
			[w.savings, w.wallet, w.card].sort(),
		);
	});

	it("a fee of zero writes no expense and no leg", async () => {
		const w = await world();
		const r = await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.savings,
			toAccountId: w.wallet,
			fromAmount: "1000",
			fee: { amount: "0" },
		});
		expect(r.value.feeExpenseId).toBeNull();
		expect(await legsOf(r.value.transferId)).toHaveLength(2);
		expect(await fixtureDb.expense.count({ where: { userId: w.userId } })).toBe(
			0,
		);
	});

	it("the preview names the same figures as the write and writes nothing", async () => {
		const w = await world();
		const input: CreateTransferInput = {
			fromAccountId: w.savings,
			toAccountId: w.wallet,
			fromAmount: "300000",
			fee,
		};
		const before = await counts(w.userId);
		const dry = await forUser(w.userId).preview(createTransfer, input);
		expect(await counts(w.userId)).toEqual(before);
		expect(await balanceOf(w.savings)).toBe("5000000");

		const wet = await forUser(w.userId).apply(createTransfer, input);
		expect(dry.changes).toEqual(wet.changes);
		expect(dry.unchanged).toEqual(wet.unchanged);
		expect(ids(wet.changes)).toEqual(
			["accounts.balance", "netWorth", "spent"].sort(),
		);
		expect(ids(wet.unchanged)).toEqual([
			"netWorthChange.exchange",
			"notTracked",
		]);
	});
});

describe("transfer.create: counted units follow money out of the budget", () => {
	it("a move between two places outside the budget moves the counted units with it", async () => {
		const w = await world();
		// Counted by an earlier Move in: USD 60 of the 100 are already in the budget's count.
		await adminDb.assetAccount.update({
			where: { id: w.usdOfficial },
			data: { balance: "100", countedUnits: "60" },
		});
		const r = await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.usdOfficial,
			toAccountId: w.usdBlue,
			fromAmount: "40",
		});

		// min(counted 60, moved 40) leaves the source and arrives at the destination.
		const row = await fixtureDb.transfer.findUniqueOrThrow({
			where: { id: r.value.transferId },
		});
		expect(
			[row.countedFromUnits, row.countedToUnits].map((d) => d.toString()),
		).toEqual(["40", "40"]);
		const counted = async (id: string) =>
			(
				await fixtureDb.assetAccount.findUniqueOrThrow({ where: { id } })
			).countedUnits.toString();
		expect(await counted(w.usdOfficial)).toBe("20");
		expect(await counted(w.usdBlue)).toBe("40");
		expect(r.value.budget.effect).toBe("none");
	});

	it("deleting it gives the counted units back, never below zero at the destination", async () => {
		const w = await world();
		await adminDb.assetAccount.update({
			where: { id: w.usdOfficial },
			data: { balance: "100", countedUnits: "60" },
		});
		const made = await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.usdOfficial,
			toAccountId: w.usdBlue,
			fromAmount: "40",
		});
		// The destination's counted units moved on since (a later move out of it).
		await adminDb.assetAccount.update({
			where: { id: w.usdBlue },
			data: { countedUnits: "10" },
		});
		await forUser(w.userId).apply(deleteTransfer, {
			transferId: made.value.transferId,
		});
		const counted = async (id: string) =>
			(
				await fixtureDb.assetAccount.findUniqueOrThrow({ where: { id } })
			).countedUnits.toString();
		expect(await counted(w.usdOfficial)).toBe("60");
		// GREATEST(0, 10 - 40), then capped at the balance 0 the delete leaves.
		expect(await counted(w.usdBlue)).toBe("0");
		expect(await balanceOf(w.usdOfficial)).toBe("100");
		expect(await balanceOf(w.usdBlue)).toBe("0");
	});
});

describe("transfer.create: refusals write nothing", () => {
	const wrote = (w: World) => counts(w.userId);

	it("a closed account on either side", async () => {
		const w = await world();
		await closeAccount(adminDb, w.userId, w.wallet);
		const before = await wrote(w);
		for (const input of [
			{ fromAccountId: w.wallet, toAccountId: w.savings },
			{ fromAccountId: w.savings, toAccountId: w.wallet },
		]) {
			await expect(
				forUser(w.userId).apply(createTransfer, { ...input, fromAmount: "10" }),
			).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: "This account is closed. Reopen it to change it.",
			});
		}
		expect(await wrote(w)).toEqual(before);
	});

	it("a future day, in the user's zone", async () => {
		const w = await world();
		const before = await wrote(w);
		await expect(
			forUser(w.userId).apply(createTransfer, {
				fromAccountId: w.savings,
				toAccountId: w.wallet,
				fromAmount: "10",
				date: "2026-03-11",
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "A money move cannot be dated in the future",
		});
		// Today in Buenos Aires is accepted.
		await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.savings,
			toAccountId: w.wallet,
			fromAmount: "10",
			date: "2026-03-10",
		});
		expect((await wrote(w))[0]).toBe(before[0] + 1);
	});

	it("an exchange with no rate and no typed amount, never at a rate of 1", async () => {
		const w = await world();
		const before = await wrote(w);
		await expect(
			forUser(w.userId).apply(createTransfer, {
				fromAccountId: w.savings,
				toAccountId: null,
				toCurrency: "ZZZ",
				fromAmount: "1000",
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "No exchange rate for ARS to ZZZ. Type what arrived.",
		});
		expect(await wrote(w)).toEqual(before);
		expect(await balanceOf(w.savings)).toBe("5000000");
	});

	it("a typed amount into an unpriced currency books no home value and no net worth effect", async () => {
		const w = await world();
		const r = await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.savings,
			toAccountId: null,
			toCurrency: "ZZZ",
			fromAmount: "1000",
			toAmount: "5",
		});
		expect(r.value.netWorthEffect).toBeNull();
		expect(r.value.vsReference).toBeNull();
		const legs = (await legsOf(r.value.transferId)).map(leg);
		const out = legs.find((l) => l.accountId === w.savings);
		const arrived = legs.find((l) => l.accountId === null);
		expect(out?.home).toBe("-1000");
		expect(arrived).toMatchObject({
			amount: "5",
			home: null,
			homeCurrency: null,
		});
		// ARS 1,000 leaves the budget; the Not tracked side cannot be valued.
		expect(r.value.budget).toMatchObject({ effect: "leaves" });
	});

	it("another user's account, a repeat of the same place and a zero amount", async () => {
		const w = await world();
		const other = await world();
		const before = await wrote(w);
		await expect(
			forUser(w.userId).apply(createTransfer, {
				fromAccountId: other.savings,
				toAccountId: w.wallet,
				fromAmount: "10",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			forUser(w.userId).apply(createTransfer, {
				fromAccountId: w.savings,
				toAccountId: w.savings,
				fromAmount: "10",
			}),
		).rejects.toMatchObject({ message: "Pick two different places" });
		await expect(
			forUser(w.userId).apply(createTransfer, {
				fromAccountId: w.savings,
				toAccountId: w.wallet,
				fromAmount: "0",
			}),
		).rejects.toMatchObject({ message: "Enter an amount above zero" });
		expect(await wrote(w)).toEqual(before);
		expect(await balanceOf(other.savings)).toBe("5000000");
	});

	it("a client id that is taken", async () => {
		const w = await world();
		const id = randomUUID();
		const input = {
			id,
			fromAccountId: w.savings,
			toAccountId: w.wallet,
			fromAmount: "10",
		};
		await forUser(w.userId).apply(createTransfer, input);
		await expect(
			forUser(w.userId).apply(createTransfer, input),
		).rejects.toThrow();
		expect(await balanceOf(w.savings)).toBe("4999990");
		expect(await adminDb.transfer.count({ where: { id } })).toBe(1);
	});
});

describe("transfer.delete and its undo", () => {
	it("takes the move, its legs and its fee expense back, and recreate brings them back", async () => {
		const w = await world();
		const run = forUser(w.userId);
		const input: CreateTransferInput = {
			fromAccountId: w.savings,
			toAccountId: w.wallet,
			fromAmount: "300000",
			fee: { amount: "1500" },
			note: "Rent share",
			date: "2026-03-08",
		};
		const made = await run.apply(createTransfer, input);
		const first = made.value;
		const start = await counts(w.userId);

		const removed = await run.apply(deleteTransfer, {
			transferId: first.transferId,
		});
		expect(await counts(w.userId)).toEqual([0, 0, 0]);
		expect(await balanceOf(w.savings)).toBe("5000000");
		expect(await balanceOf(w.wallet)).toBe("1000000");
		expect(removed.value.recreate).toEqual({
			id: first.transferId,
			fromAccountId: w.savings,
			toAccountId: w.wallet,
			fromCurrency: "ARS",
			toCurrency: "ARS",
			fromAmount: "300000",
			toAmount: "300000",
			kind: "TRANSFER",
			date: "2026-03-08",
			note: "Rent share",
			fee: { amount: "1500", accountId: w.savings },
		});
		expect(delta(removed, "spent")).toEqual(ARS(-150_000));

		const again = await run.apply(createTransfer, removed.value.recreate);
		expect(again.value.transferId).toBe(first.transferId);
		expect(await counts(w.userId)).toEqual(start);
		expect(await balanceOf(w.savings)).toBe("4698500");
		expect(await balanceOf(w.wallet)).toBe("1300000");
		// The fee is booked again as a new expense.
		expect(again.value.feeExpenseId).toEqual(expect.any(String));
		expect(again.value.feeExpenseId).not.toBe(first.feeExpenseId);
		expect(
			(
				await fixtureDb.transfer.findUniqueOrThrow({
					where: { id: first.transferId },
				})
			).note,
		).toBe("Rent share");
	});

	it("delete's preview writes nothing and names the figures it moves", async () => {
		const w = await world();
		const made = await forUser(w.userId).apply(createTransfer, {
			fromAccountId: w.savings,
			toAccountId: w.wallet,
			fromAmount: "300000",
			fee: { amount: "1500" },
		});
		const before = await counts(w.userId);
		const dry = await forUser(w.userId).preview(deleteTransfer, {
			transferId: made.value.transferId,
		});
		expect(await counts(w.userId)).toEqual(before);
		expect(ids(dry.changes)).toEqual(
			["accounts.balance", "netWorth", "spent"].sort(),
		);
		expect(delta(dry, "netWorth")).toEqual(ARS(150_000));
	});

	it("refuses another user's transfer and an unknown one", async () => {
		const w = await world();
		const other = await world();
		const made = await forUser(other.userId).apply(createTransfer, {
			fromAccountId: other.savings,
			toAccountId: other.wallet,
			fromAmount: "10",
		});
		for (const transferId of [made.value.transferId, randomUUID()]) {
			await expect(
				forUser(w.userId).apply(deleteTransfer, { transferId }),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
		}
		expect(await balanceOf(other.savings)).toBe("4999990");
	});

	it("the undo of a create is a delete, and the undo of that is the create again", async () => {
		const w = await world();
		const run = forUser(w.userId);
		const made = await run.apply(createTransfer, {
			fromAccountId: w.savings,
			toAccountId: w.usdBlue,
			fromAmount: "1545000",
		});
		expect(made.undo).toMatchObject({
			kind: "revert",
			mutation: "transfer.delete",
			rows: [{ table: "transfer", id: made.value.transferId }],
		});
		const removed = await run.apply(deleteTransfer, {
			transferId: made.value.transferId,
		});
		expect(removed.undo).toMatchObject({
			kind: "revert",
			mutation: "transfer.create",
			rows: [{ table: "transfer", id: made.value.transferId }],
		});
		expect(await balanceOf(w.usdBlue)).toBe("0");
		await run.apply(createTransfer, removed.value.recreate);
		expect(await balanceOf(w.usdBlue)).toBe("1000");
		expect(await balanceOf(w.savings)).toBe("3455000");
	});
});

describe("the web router", () => {
	function caller(userId: string) {
		return createCallerFactory(wealthRouter)({
			session: makeSession({ id: userId }),
			db: adminDb,
			headers: new Headers(),
		});
	}

	it("previews, saves, deletes and recreates through transfers.*", async () => {
		const w = await world();
		const api = caller(w.userId);
		const input = {
			fromAccountId: w.savings,
			toAccountId: w.wallet,
			fromAmount: "300000",
			fee: { amount: "1500" },
		};
		const dry = await api.transfers.create.preview(input);
		expect(await counts(w.userId)).toEqual([0, 0, 0]);

		const saved = await api.transfers.create.save(input);
		expect(saved.changes).toEqual(dry.changes);
		expect(saved.value.kind).toBe("TRANSFER");
		expect(await balanceOf(w.savings)).toBe("4698500");

		const deleted = await api.transfers.delete.save({
			transferId: saved.value.transferId,
		});
		expect(await counts(w.userId)).toEqual([0, 0, 0]);
		const back = await api.transfers.recreate.save(deleted.value.recreate);
		expect(back.value.transferId).toBe(saved.value.transferId);
		expect(await balanceOf(w.savings)).toBe("4698500");
	});

	it("refuses another user's account and a closed one with the service's errors", async () => {
		const w = await world();
		const other = await world();
		await closeAccount(adminDb, w.userId, w.wallet);
		const api = caller(w.userId);
		await expect(
			api.transfers.create.save({
				fromAccountId: other.savings,
				toAccountId: w.savings,
				fromAmount: "10",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			api.transfers.create.save({
				fromAccountId: w.savings,
				toAccountId: w.wallet,
				fromAmount: "10",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(await counts(w.userId)).toEqual([0, 0, 0]);
	});
});
