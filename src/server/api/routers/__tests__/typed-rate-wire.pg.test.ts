/**
 * A rate the web sends is decimal text, and a float is refused. Hand-derived:
 *
 * - The old expense form's typed rate: EUR 1,000 at 1,234.567890123456 in an
 *   ARS home books home rate 1234.567890123456 (12 decimals, as typed) and
 *   ARS 1,234,567.890123456, so ARS 1,234,567.89. The rate has 16 significant
 *   digits, more than a double reliably holds; the text keeps them all.
 * - A table rate sent as text is accepted (USD 1,000 at the default Blue
 *   1,468 is ARS 1,468,000), a number is not.
 * - A wealth account saved with a custom rate "1560.123456" keeps those six
 *   decimals (the column's scale); an edit that sends the stored text back
 *   (what the account sheet does) keeps them; a number is refused; a rate
 *   with more digits than a double holds (22 significant digits) is a 400,
 *   never stored altered.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "~/server/api/trpc";
import { arsUser, seedArsRates, TODAY } from "~/server/services/accounts/test-fixtures";
import { adminDb } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { expenseRouter } from "../expense";
import { wealthRouter } from "../wealth";

beforeAll(seedArsRates);

async function setup() {
	const { user } = await arsUser();
	const ctx = {
		session: makeSession({ id: user.id }),
		db: adminDb,
		headers: new Headers(),
	};
	const category = await adminDb.category.create({
		data: { userId: user.id, name: "Travel", color: "teal", kind: "EXPENSE" },
	});
	return {
		expense: createCallerFactory(expenseRouter)(ctx),
		wealth: createCallerFactory(wealthRouter)(ctx),
		categoryId: category.id,
	};
}

const hotel = (categoryId: string) => ({
	id: crypto.randomUUID(),
	title: "Hotel",
	amount: 1000,
	currency: "EUR",
	date: TODAY,
	categoryId,
});

const booked = (id: string) =>
	adminDb.expense.findUniqueOrThrow({
		where: { id },
		select: { rateType: true, homeRate: true, homeAmount: true },
	});

describe("the old expense form's rate", () => {
	it("a typed rate books every digit it was typed with", async () => {
		const { expense, categoryId } = await setup();
		const input = {
			...hotel(categoryId),
			pricingSource: "custom",
			customRate: { base: "EUR", value: "1234.567890123456" },
		};
		await expense.createExpense(input);
		const row = await booked(input.id);
		expect(row.rateType).toBe("custom");
		expect(row.homeRate?.toFixed(12)).toBe("1234.567890123456");
		expect(row.homeAmount?.toFixed(2)).toBe("1234567.89");
	});

	it("a table rate goes as text, and a float is refused", async () => {
		const { expense, categoryId } = await setup();
		const usd = { ...hotel(categoryId), currency: "USD" };
		await expense.createExpense({
			...usd,
			pricingSource: "official",
			exchangeRate: "1",
		});
		// USD has no rate type of its own: the home leg takes the default,
		// Blue at 1,468, so USD 1,000 is ARS 1,468,000.
		expect((await booked(usd.id)).homeAmount?.toFixed(2)).toBe("1468000.00");
		await expect(
			expense.createExpense({
				...hotel(categoryId),
				currency: "USD",
				exchangeRate: 1 as unknown as string,
			}),
		).rejects.toThrow();
	});
});

describe("a wealth account's rate", () => {
	const fields = {
		name: "Euro cash",
		type: "CASH" as const,
		currency: "EUR",
		balance: 100,
		exchangeRateType: "custom",
		isLiquid: true,
	};

	it("keeps a custom rate's six decimals, also when an update sends it back", async () => {
		const { wealth } = await setup();
		const made = await wealth.createAsset({
			...fields,
			exchangeRate: "1560.123456",
		});
		const stored = () =>
			adminDb.assetAccount.findUniqueOrThrow({ where: { id: made.id } });
		expect((await stored()).exchangeRate?.toString()).toBe("1560.123456");

		// The old Update balance dialog sends the stored rate back with the balance.
		await wealth.updateAssetBalance({
			assetId: made.id,
			newBalance: 120,
			exchangeRateType: "custom",
			exchangeRate: "1560.123456",
		});
		const row = await stored();
		expect(row.exchangeRate?.toString()).toBe("1560.123456");
		expect(row.balance.toString()).toBe("120");
	});

	it("refuses a float and a rate a double would change", async () => {
		const { wealth } = await setup();
		await expect(
			wealth.createAsset({
				...fields,
				exchangeRate: 1560.5 as unknown as string,
			}),
		).rejects.toThrow();
		await expect(
			wealth.createAsset({
				...fields,
				exchangeRate: "1234567890123456.123456",
			}),
		).rejects.toThrow("too many digits");
		await expect(
			wealth.updateAssetBalance({
				assetId: "any",
				newBalance: 1,
				exchangeRate: 1560.5 as unknown as string,
			}),
		).rejects.toThrow();
	});
});
