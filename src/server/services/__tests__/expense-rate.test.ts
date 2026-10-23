/**
 * The home leg an expense books when it is saved (2A.2, N73, T7): its rate
 * type and home value are stored on the row so later rates never move it.
 * The entry leg is pinned in expense-rate.characterization.test.ts.
 *
 * Rates are DEFAULT_RATES (~/test/rate-table): ARS blue 1,560, official
 * 1,495; EUR official 0.8787; CLP has none. The user's home is ARS.
 */
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MissingRateError } from "~/lib/money";
import { makeExpense } from "~/test/factories";
import { createMockDb } from "~/test/mock-db";
import { useRateTable } from "~/test/rate-table";
import { ExpenseService, rateChoice } from "../expense.service";
import { recurringEntryData } from "../money-in.service";

const DATE = new Date("2026-08-10T12:00:00Z");
const BASE = { id: "exp-1", title: "Netflix", date: DATE };

type Row = Record<string, unknown>;

describe("the home leg an expense books", () => {
	let db: ReturnType<typeof createMockDb>;
	let service: ExpenseService;

	const firstData = (calls: unknown[][]) =>
		(calls[0]?.[0] as { data: Row } | undefined)?.data;
	const created = () => firstData(db.expense.create.mock.calls);
	const updated = () => firstData(db.expense.update.mock.calls);
	const asUser = (homeCurrency: string, defaultRateTypes: object = {}) =>
		db.user.findUnique.mockResolvedValue({ homeCurrency, defaultRateTypes });

	beforeEach(() => {
		vi.clearAllMocks();
		db = createMockDb();
		useRateTable(db);
		asUser("ARS");
		db.expense.create.mockResolvedValue(makeExpense());
		db.expense.update.mockResolvedValue(makeExpense());
		service = new ExpenseService(db as never);
	});

	describe("creating", () => {
		it("USD 12.99 in an ARS home books blue: ARS 20,264.40 (T7)", async () => {
			// The old form sends "official" for every USD expense: that named
			// the USD leg, so the pair's default (blue) applies.
			await service.createExpense("u1", {
				...BASE,
				amount: 12.99,
				currency: "USD",
				pricingSource: "official",
			});
			expect(created()).toMatchObject({
				exchangeRate: 1,
				amountInUSD: 12.99,
				pricingSource: "official",
				rateType: "blue",
				homeCurrency: "ARS",
				homeRate: "1560",
				homeAmount: "20264.40",
			});
		});

		it("EUR 100 sent as official by the old form books the ARS leg at blue: ARS 177,534.99", async () => {
			// The old form sends "official" for EUR on its own. It picks the EUR
			// leg (0.8787); the ARS leg is the user's default, blue 1,560:
			// 100 x 1,560 / 0.8787 = 177,534.99 (official would be 170,137.70).
			await service.createExpense("u1", {
				...BASE,
				amount: 100,
				currency: "EUR",
				pricingSource: "official",
			});
			expect(created()).toMatchObject({
				exchangeRate: 0.8787,
				amountInUSD: 113.8,
				rateType: "blue",
				homeAmount: "177534.99",
			});
		});

		it("the picked type wins: official 12.99 x 1,495 = 19,420.05", async () => {
			await service.createExpense("u1", {
				...BASE,
				amount: 12.99,
				currency: "USD",
				rateType: "official",
			});
			expect(created()).toMatchObject({
				rateType: "official",
				homeAmount: "19420.05",
			});
		});

		it("the user's default for their home applies", async () => {
			asUser("ARS", { ARS: "official" });
			await service.createExpense("u1", {
				...BASE,
				amount: 12.99,
				currency: "USD",
			});
			expect(created()).toMatchObject({ rateType: "official" });
		});

		it("Custom for a USD expense: 1 USD = 1,500 ARS gives ARS 19,485.00", async () => {
			await service.createExpense("u1", {
				...BASE,
				amount: 12.99,
				currency: "USD",
				rateType: "custom",
				customRate: { base: "USD", value: 1500 },
			});
			expect(created()).toMatchObject({
				exchangeRate: 1,
				rateType: "custom",
				homeRate: "1500",
				homeAmount: "19485.00",
			});
		});

		it("Custom with no rate typed is refused", async () => {
			await expect(
				service.createExpense("u1", {
					...BASE,
					amount: 12.99,
					currency: "USD",
					rateType: "custom",
				}),
			).rejects.toBeInstanceOf(TRPCError);
			expect(db.expense.create).not.toHaveBeenCalled();
		});

		it("a missing home rate blocks saving (never 0 or 1)", async () => {
			asUser("CLP");
			await expect(
				service.createExpense("u1", { ...BASE, amount: 10, currency: "USD" }),
			).rejects.toEqual(new MissingRateError("CLP"));
			expect(db.expense.create).not.toHaveBeenCalled();
		});
	});

	describe("editing", () => {
		const bookedUsd = makeExpense({
			id: "exp-1",
			userId: "u1",
			currency: "USD",
			amount: 10,
			exchangeRate: 1,
			amountInUSD: 10,
			pricingSource: "official",
			...({
				rateType: "blue",
				homeCurrency: "ARS",
				homeRate: "1480",
				homeAmount: "14800.00",
			} as object),
		});

		it("keeps the booked rate when the rate is untouched, for a new amount too", async () => {
			db.expense.findFirst.mockResolvedValue(bookedUsd);
			await service.updateExpense("u1", {
				...BASE,
				amount: 20,
				currency: "USD",
				exchangeRate: 1,
				pricingSource: "official",
			});
			// 20 x 1,480, not today's 1,560
			expect(updated()).toMatchObject({
				rateType: "blue",
				homeRate: "1480",
				homeAmount: "29600.00",
			});
			expect(db.exchangeRate.findMany).not.toHaveBeenCalled();
		});

		it("switching to EUR in the old form books the ARS leg at blue too", async () => {
			db.expense.findFirst.mockResolvedValue(bookedUsd);
			await service.updateExpense("u1", {
				...BASE,
				amount: 100,
				currency: "EUR",
				pricingSource: "official",
			});
			expect(updated()).toMatchObject({
				exchangeRate: 0.8787,
				rateType: "blue",
				homeAmount: "177534.99",
			});
		});

		it("picking another type books it again", async () => {
			db.expense.findFirst.mockResolvedValue(bookedUsd);
			await service.updateExpense("u1", {
				...BASE,
				amount: 10,
				currency: "USD",
				rateType: "official",
			});
			expect(updated()).toMatchObject({
				rateType: "official",
				homeAmount: "14950.00",
			});
		});

		it("an expense saved before M2 books its home leg on the next save", async () => {
			db.expense.findFirst.mockResolvedValue(
				makeExpense({ id: "exp-1", userId: "u1", currency: "USD", amount: 10 }),
			);
			await service.updateExpense("u1", {
				...BASE,
				amount: 10,
				currency: "USD",
			});
			expect(updated()).toMatchObject({
				exchangeRate: 1,
				rateType: "blue",
				homeCurrency: "ARS",
				homeAmount: "15600.00",
			});
		});

		it("a home currency change books the new home", async () => {
			asUser("USD");
			db.expense.findFirst.mockResolvedValue(
				makeExpense({
					id: "exp-1",
					userId: "u1",
					currency: "ARS",
					amount: 15_600,
					exchangeRate: 1560,
					amountInUSD: 10,
					...({
						rateType: "blue",
						homeCurrency: "ARS",
						homeRate: "1",
					} as object),
				}),
			);
			await service.updateExpense("u1", {
				...BASE,
				amount: 15_600,
				currency: "ARS",
			});
			expect(updated()).toMatchObject({
				exchangeRate: 1560,
				homeCurrency: "USD",
				homeAmount: "10.00",
			});
		});
	});

	it("a recurring post books its home leg like a saved expense", async () => {
		const row = await recurringEntryData(db as never, {
			id: "t1",
			userId: "u1",
			name: "Netflix",
			amount: 12.99,
			currency: "USD",
			categoryId: null,
			nextDueDate: DATE,
		});
		expect(row).toMatchObject({
			pricingSource: "RECURRING",
			exchangeRate: 1,
			rateType: "blue",
			homeCurrency: "ARS",
			homeAmount: "20264.40",
		});
	});
});

describe("rateChoice", () => {
	const input = { amount: 10, currency: "ARS", date: DATE };
	const saved = {
		currency: "ARS",
		exchangeRate: 1400,
		rateType: "blue",
		homeCurrency: "ARS",
		homeRate: "1",
	};

	it("takes the old form's type for the entry leg only", () => {
		expect(
			rateChoice({ ...input, pricingSource: "official" }, null, "USD"),
		).toEqual({ kind: "table", rateType: null, entryType: "official" });
	});

	it("a picked type applies to both legs", () => {
		expect(
			rateChoice(
				{ ...input, rateType: "mep", pricingSource: "official" },
				null,
				"USD",
			),
		).toEqual({ kind: "table", rateType: "mep" });
	});

	it("reads placeholders as no type", () => {
		expect(
			rateChoice({ ...input, pricingSource: "MANUAL" }, null, "USD"),
		).toEqual({
			kind: "table",
			rateType: null,
			entryType: null,
		});
	});

	it("keeps the old form's custom entry leg", () => {
		expect(
			rateChoice(
				{ ...input, pricingSource: "custom", exchangeRate: 1500 },
				null,
				"USD",
			),
		).toEqual({ kind: "entryLeg", exchangeRate: 1500, rateType: "custom" });
	});

	it("keeps a booked row untouched", () => {
		expect(rateChoice({ ...input, exchangeRate: 1400 }, saved, "ARS")).toEqual({
			kind: "kept",
			exchangeRate: 1400,
			homeRate: "1",
			rateType: "blue",
		});
	});

	it("a new entry rate is not untouched", () => {
		expect(rateChoice({ ...input, exchangeRate: 1500 }, saved, "ARS")).toEqual({
			kind: "table",
			rateType: null,
			entryType: null,
		});
	});
});
