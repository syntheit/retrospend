import { describe, expect, it } from "vitest";
import { expenseSchema } from "~/hooks/use-expense-form";

const valid = {
	title: "Lunch",
	amount: 12.5,
	currency: "USD",
	date: new Date(2026, 9, 1),
	categoryId: "cat_1",
};

function messages(input: unknown) {
	const result = expenseSchema.safeParse(input);
	if (result.success) return {};
	return Object.fromEntries(
		result.error.issues.map((issue) => [issue.path.join("."), issue.message]),
	);
}

describe("expense form schema", () => {
	it("accepts a filled form", () => {
		expect(expenseSchema.safeParse(valid).success).toBe(true);
	});

	it("asks for an amount when the field is blank or cleared", () => {
		// The form starts with "" and an emptied input can come back undefined or NaN
		expect(messages({ ...valid, amount: "" }).amount).toBe("Amount is required");
		expect(messages({ ...valid, amount: undefined }).amount).toBe("Amount is required");
		expect(messages({ ...valid, amount: Number.NaN }).amount).toBe("Amount is required");
	});

	it("keeps the custom messages for range and select checks", () => {
		expect(messages({ ...valid, amount: -1 }).amount).toBe("Amount must be positive");
		expect(messages({ ...valid, currency: "ZZZ" }).currency).toBe(
			"Please select a valid currency",
		);
		expect(messages({ ...valid, categoryId: "" }).categoryId).toBe(
			"Please select a category",
		);
		expect(messages({ ...valid, exchangeRate: 0 }).exchangeRate).toBe(
			"Exchange rate must be positive",
		);
	});

	it("asks for a date when the picker is cleared", () => {
		expect(messages({ ...valid, date: undefined }).date).toBe("Please select a date");
	});

	it("lets tiny amounts round to 0 USD", () => {
		expect(expenseSchema.safeParse({ ...valid, amountInUSD: 0 }).success).toBe(true);
	});
});
