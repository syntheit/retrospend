/**
 * The Add family on real Postgres (4G): every figure recomputed by hand.
 * ARS home; ARS 1,468 Blue, 1,412 Official, 1,449 MEP per USD.
 *
 * - A USD expense in an ARS home books its home leg at the picked type:
 *   USD 100 at Blue is ARS 146,800; at Official ARS 141,200.
 * - A typed rate of 1,475 books ARS 147,500, and the undo of a delete brings
 *   the same row back. No rate (UYU) blocks saving: never 1.
 * - An Exchange of ARS 442,500 for USD 300 derives 1,475 per USD, ARS 2,100
 *   more than Blue (300 x 1,468 = 440,400).
 * - Income with Use my plan: USD 1,000 fills Rent 500 and Dining 200; 300
 *   stays Not planned yet; the preview lists the same lines and writes none.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	arsUser,
	isoDay,
	openAccount,
	seedArsRates,
	TODAY,
} from "../accounts/test-fixtures";
import {
	seedUser,
	setupInput,
} from "../envelope/__tests__/pg-fixture";
import { getMonth } from "../envelope/read.service";
import { setupEnvelopeBook } from "../envelope/setup.mutation";
import { createExpense } from "../expense-create.mutation";
import { addIncome } from "../income/add.mutation";
import { deleteIncome } from "../income/delete.mutation";
import { rateOptions } from "../rate-types";
import { createTransfer } from "../transfers/create.mutation";
import { entryCatalog } from "./catalog";
import { deleteExpenseEntry, updateExpenseEntry } from "./expense.mutation";
import { toExpenseInput } from "./input";
import { createSharedExpense } from "./shared.mutation";
import { rateOptionsView, transferView } from "./views";

beforeAll(seedArsRates);

const ARS = (minor: number) => ({ minor, currency: "ARS" });
const USD = (minor: number) => ({ minor, currency: "USD" });
const delta = (
	r: { changes: readonly { id: string; currency: string; delta: unknown }[] },
	id: string,
) => r.changes.find((c) => c.id === id)?.delta ?? null;

async function category(userId: string, name = "Subscriptions") {
	return adminDb.category.create({
		data: { userId, name, color: "teal", kind: "EXPENSE" },
	});
}

const usd100 = (id: string, categoryId: string, rateType?: string) =>
	toExpenseInput(
		{
			id,
			title: "Streamly",
			amount: "100",
			currency: "USD",
			date: isoDay(TODAY),
			categoryId,
			...(rateType ? { rateType } : {}),
		},
		"UTC",
	);

describe("Add expense: rate per entry", () => {
	it("USD 100 in an ARS home: Blue books ARS 146,800, Official ARS 141,200", async () => {
		const { user } = await arsUser();
		const cat = await category(user.id);
		const blue = await forUser(user.id).apply(
			createExpense,
			usd100(crypto.randomUUID(), cat.id, "blue"),
		);
		const official = await forUser(user.id).apply(
			createExpense,
			usd100(crypto.randomUUID(), cat.id, "official"),
		);
		expect(blue.value).toMatchObject({ rateType: "blue", homeCurrency: "ARS" });
		expect(blue.value.homeAmount?.toString()).toBe("146800");
		expect(official.value.homeAmount?.toString()).toBe("141200");
		// Spending moves in the entry's own currency; accounts and net worth do not (N75).
		expect(delta(blue, "spent")).toEqual(USD(10_000));
		expect(blue.changes.map((c) => c.id)).toEqual(["spent"]);
	});

	it("the rate strip offers each type booked as saving books it; Blue is the ARS default", async () => {
		const { user } = await arsUser();
		const view = rateOptionsView(
			"USD",
			await rateOptions(adminDb, user.id, {
				currency: "USD",
				date: TODAY,
				amount: 100,
			}),
		);
		expect(view.defaultType).toBe("blue");
		const byType = Object.fromEntries(
			view.options.map((o) => [o.rateType, o.home]),
		);
		expect(byType).toMatchObject({
			blue: ARS(14_680_000),
			official: ARS(14_120_000),
			mep: ARS(14_490_000),
		});
		expect(view.options.find((o) => o.rateType === "blue")?.rate).toEqual({
			unit: USD(100),
			value: ARS(146_800),
		});
	});

	it("no UYU rate: the strip says missing and saving throws, never at 1", async () => {
		const { user } = await arsUser();
		const cat = await category(user.id);
		const view = await rateOptions(adminDb, user.id, {
			currency: "UYU",
			date: TODAY,
		});
		expect(view.missing).toEqual({ currency: "UYU" });
		await expect(
			forUser(user.id).preview(createExpense, {
				...usd100(crypto.randomUUID(), cat.id),
				currency: "UYU",
			}),
		).rejects.toThrow();
	});

	it("a typed rate of 1,475 books ARS 147,500; delete and its undo bring the same row back", async () => {
		const { user } = await arsUser();
		const cat = await category(user.id);
		const id = crypto.randomUUID();
		await forUser(user.id).apply(
			createExpense,
			toExpenseInput(
				{
					id,
					title: "Streamly",
					amount: "100",
					currency: "USD",
					date: isoDay(TODAY),
					categoryId: cat.id,
					customRate: "1475",
				},
				"UTC",
			),
		);
		const saved = await adminDb.expense.findUniqueOrThrow({ where: { id } });
		expect(saved).toMatchObject({ rateType: "custom" });
		expect(saved.homeAmount?.toString()).toBe("147500");

		const preview = await forUser(user.id).preview(deleteExpenseEntry, { id });
		expect(delta(preview, "spent")).toEqual(USD(-10_000));
		expect(await adminDb.expense.count({ where: { id } })).toBe(1);

		const gone = await forUser(user.id).apply(deleteExpenseEntry, { id });
		expect(await adminDb.expense.count({ where: { id } })).toBe(0);
		await forUser(user.id).apply(createExpense, gone.value.restore);
		const back = await adminDb.expense.findUniqueOrThrow({ where: { id } });
		expect(back.homeAmount?.toString()).toBe("147500");
		expect(back.homeRate?.toString()).toBe(saved.homeRate?.toString());
		expect(back.rateType).toBe("custom");
	});

	it("an edit's undo puts back the amount, the rate type and its home value", async () => {
		const { user } = await arsUser();
		const cat = await category(user.id);
		const id = crypto.randomUUID();
		await forUser(user.id).apply(createExpense, usd100(id, cat.id, "blue"));
		const edited = await forUser(user.id).apply(updateExpenseEntry, {
			...usd100(id, cat.id, "official"),
			amount: 120,
		});
		const mid = await adminDb.expense.findUniqueOrThrow({ where: { id } });
		expect(mid.homeAmount?.toString()).toBe("169440");
		expect(delta(edited, "spent")).toEqual(USD(2_000));

		await forUser(user.id).apply(updateExpenseEntry, edited.value.restore);
		const back = await adminDb.expense.findUniqueOrThrow({ where: { id } });
		expect(back.amount.toString()).toBe("100");
		expect(back.rateType).toBe("blue");
		expect(back.homeAmount?.toString()).toBe("146800");
	});
});

describe("Add expense: shared", () => {
	it("a preview writes no row and tells nobody; the save does both", async () => {
		const { user } = await arsUser();
		const { user: other } = await createTestUser();
		const input = {
			amount: 6000,
			currency: "ARS",
			description: "Dinner",
			date: TODAY,
			paidBy: { participantType: "user" as const, participantId: user.id },
			splitWith: [
				{ participantType: "user" as const, participantId: user.id },
				{ participantType: "user" as const, participantId: other.id },
			],
			splitMode: "EQUAL" as const,
		};
		const told = () => adminDb.notification.count({ where: { userId: other.id } });
		const notify: (() => Promise<void>)[] = [];

		const preview = await forUser(user.id).preview(createSharedExpense, {
			...input,
			notify,
		});
		expect(delta(preview, "owed.owedToYou")).toEqual(ARS(300_000));
		expect(
			await adminDb.sharedTransaction.count({
				where: { createdById: user.id },
			}),
		).toBe(0);
		expect(await told()).toBe(0);

		const saveQueue: (() => Promise<void>)[] = [];
		const saved = await forUser(user.id).apply(createSharedExpense, {
			...input,
			notify: saveQueue,
		});
		expect(delta(saved, "owed.owedToYou")).toEqual(ARS(300_000));
		expect(await told()).toBe(0);
		for (const send of saveQueue) await send();
		expect(await told()).toBe(1);
	});
});

describe("Transfer: Exchange", () => {
	it("ARS 442,500 for USD 300: 1,475 per USD, ARS 2,100 more than Blue", async () => {
		const { user } = await arsUser();
		const wallet = await openAccount(user.id, "Wallet", "CASH", "ARS", 1_000_000);
		const usd = await openAccount(user.id, "USD cash", "CASH", "USD", 0);
		const r = await forUser(user.id).preview(createTransfer, {
			fromAccountId: wallet,
			toAccountId: usd,
			fromAmount: "442500",
			toAmount: "300",
		});
		const view = transferView(r.value);
		expect(view.rate).toEqual({ unit: USD(100), value: ARS(147_500) });
		expect(view.vsReference).toEqual(ARS(-210_000));
		expect(view.referenceRateType).toBe("blue");
		expect(view.accounts.map((a) => [a.name, a.before, a.after])).toEqual([
			["Wallet", ARS(100_000_000), ARS(55_750_000)],
			["USD cash", USD(0), USD(30_000)],
		]);
	});
});

describe("Add income: Use my plan", () => {
	it("USD 1,000 fills Rent 500 and Dining 200; 300 stays Not planned yet; undo takes it back", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			startingMoneyMinor: 0,
			timeZone: "UTC",
		});
		const input = {
			title: "Salary, Grupo Andino",
			amount: "1000",
			currency: "USD",
			usePlan: true,
		};
		const assigned = async () =>
			(await getMonth(s.user.id))?.groups
				.flatMap((g) => g.envelopes)
				.reduce((t, e) => t + e.assigned.minor, 0) ?? 0;

		const preview = await forUser(s.user.id).preview(addIncome, input);
		expect(preview.value.plan).toMatchObject({
			applied: true,
			rest: USD(30_000),
		});
		expect(preview.value.plan.lines.map((l) => l.amount.minor).sort()).toEqual([
			20_000, 50_000,
		]);
		expect(await assigned()).toBe(0);

		const saved = await forUser(s.user.id).apply(addIncome, input);
		expect(saved.value.plan.lines.map((l) => l.amount.minor).sort()).toEqual([
			20_000, 50_000,
		]);
		expect(await assigned()).toBe(70_000);

		await forUser(s.user.id).apply(deleteIncome, {
			expenseId: saved.value.expenseId,
		});
		expect(await assigned()).toBe(0);
	});
});

describe("entry catalog", () => {
	it("lists both kinds of categories, recents and open places with their worth", async () => {
		const { user } = await arsUser();
		const cat = await category(user.id, "Cafe");
		await forUser(user.id).apply(
			createExpense,
			usd100(crypto.randomUUID(), cat.id, "blue"),
		);
		await openAccount(user.id, "Wallet", "CASH", "ARS", 1_000);
		const c = await entryCatalog(adminDb, user.id);
		expect(c.homeCurrency).toBe("ARS");
		expect(c.recentCategoryIds).toEqual([cat.id]);
		expect(c.categories.some((x) => x.kind === "INCOME")).toBe(true);
		expect(c.places).toEqual([
			expect.objectContaining({
				name: "Wallet",
				balance: ARS(100_000),
				inBudget: true,
			}),
		]);
	});
});
