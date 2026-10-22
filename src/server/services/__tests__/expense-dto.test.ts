/**
 * The expense list DTO (2A.2 review): money columns as numbers, the booked
 * home value as Money in the list's home currency, and no raw Decimal of the
 * home leg on the wire.
 */
import { describe, expect, it } from "vitest";
import { type Expense, Prisma } from "~prisma";
import { expenseDto } from "../expense-dto";

const row = (extra: Partial<Expense> = {}) =>
	({
		id: "exp-1",
		title: "Netflix",
		amount: new Prisma.Decimal("12.99"),
		currency: "USD",
		amountInUSD: new Prisma.Decimal("12.99"),
		exchangeRate: new Prisma.Decimal(1),
		rateType: "blue",
		homeCurrency: "ARS",
		homeRate: new Prisma.Decimal(1560),
		homeAmount: new Prisma.Decimal("20264.40"),
		...extra,
	}) as Expense;

describe("expenseDto", () => {
	it("sends the booked value as Money and drops the Decimal home columns", () => {
		const dto = expenseDto(row(), "ARS");
		// 20,264.40 = 2,026,440 centavos
		expect(dto).toMatchObject({
			amount: 12.99,
			amountInUSD: 12.99,
			exchangeRate: 1,
			rateType: "blue",
			home: { minor: 2_026_440, currency: "ARS" },
		});
		expect(dto).not.toHaveProperty("homeRate");
		expect(dto).not.toHaveProperty("homeAmount");
		expect(dto).not.toHaveProperty("homeCurrency");
	});

	it("sends no booked value when it was booked in another currency", () => {
		expect(expenseDto(row(), "USD").home).toBeNull();
	});

	it("sends none for a row saved before M2", () => {
		expect(
			expenseDto(
				row({ homeCurrency: null, homeRate: null, homeAmount: null }),
				"ARS",
			).home,
		).toBeNull();
	});
});
