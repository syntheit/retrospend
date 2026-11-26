import { describe, expect, it } from "vitest";
import { createRecurringSchema, updateRecurringSchema } from "./index";
import {
	templateAmount,
	templateCreateFieldsSchema,
	templateCurrency,
	templateDueDay,
	templateEditFieldsSchema,
	templateName,
	templatePaymentSource,
	templateWebsiteUrl,
} from "./template-fields";

const valid = {
	name: "Rent",
	amount: "20",
	currency: "USD",
	nextDueDate: "2026-12-01",
	frequency: "MONTHLY",
} as const;

describe("the template field rules have one owner", () => {
	it("v1's create and update bodies are built from the very same field schemas", () => {
		expect(updateRecurringSchema.shape.name.unwrap()).toBe(templateName);
		expect(updateRecurringSchema.shape.amount.unwrap()).toBe(templateAmount);
		expect(updateRecurringSchema.shape.nextDueDate.unwrap()).toBe(
			templateDueDay,
		);
		expect(createRecurringSchema.shape.nextDueDate).toBe(templateDueDay);
		expect(createRecurringSchema.shape.amount).toBe(templateAmount);
		expect(createRecurringSchema.shape.currency).toBe(templateCurrency);
		expect(createRecurringSchema.shape.name).toBe(templateName);
		expect(createRecurringSchema.shape.websiteUrl.unwrap()).toBe(
			templateWebsiteUrl,
		);
		expect(createRecurringSchema.shape.paymentSource.unwrap()).toBe(
			templatePaymentSource,
		);
	});

	// A bad value for each field: what v1 refuses, the device schemas refuse.
	it.each([
		{ amount: "1e3" },
		{ amount: "20.123456789" },
		{ name: "" },
		{ name: "a\u0001b" },
		{ currency: "usd" },
		{ nextDueDate: "2026-02-30" },
		{ nextDueDate: "" },
	])("refuses %o in v1 and in the device schemas alike", (bad) => {
		expect(createRecurringSchema.safeParse({ ...valid, ...bad }).success).toBe(
			false,
		);
		expect(
			templateCreateFieldsSchema.safeParse({ ...valid, ...bad }).success,
		).toBe(false);
		expect(templateEditFieldsSchema.safeParse(bad).success).toBe(false);
	});

	it("an edit clears text with null and leaves out what it does not name", () => {
		expect(
			templateEditFieldsSchema.safeParse({ websiteUrl: null }).success,
		).toBe(true);
		expect(templateEditFieldsSchema.safeParse({}).success).toBe(true);
	});
});
