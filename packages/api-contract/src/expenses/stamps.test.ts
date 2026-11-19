import { describe, expect, it } from "vitest";
import { PROBLEM_STATUS, problemSchema } from "../common/errors";
import { generateOpenApiDocument } from "../openapi";
import { expensesContract } from "./index";
import {
	deleteExpenseSchema,
	previewDeleteExpenseSchema,
	updateExpenseSchema,
} from "./schemas";

const fields = {
	id: "e1",
	title: "Lunch",
	amount: "12.50",
	currency: "USD",
	date: "2026-11-18",
};

describe("expectedUpdatedAt on expense writes", () => {
	it("is optional on the PUT body and must be a timestamp", () => {
		expect(updateExpenseSchema.safeParse(fields).success).toBe(true);
		expect(
			updateExpenseSchema.safeParse({
				...fields,
				expectedUpdatedAt: "2026-11-18T10:00:00.000Z",
			}).success,
		).toBe(true);
		expect(
			updateExpenseSchema.safeParse({
				...fields,
				expectedUpdatedAt: "yesterday",
			}).success,
		).toBe(false);
	});

	it("rides in the query of DELETE and the body of its preview twin", async () => {
		expect(
			deleteExpenseSchema.safeParse({ params: { id: "e1" } }).success,
		).toBe(true);
		expect(
			deleteExpenseSchema.safeParse({
				params: { id: "e1" },
				query: { expectedUpdatedAt: "2026-11-18T10:00:00Z" },
			}).success,
		).toBe(true);
		expect(
			previewDeleteExpenseSchema.safeParse({
				id: "e1",
				expectedUpdatedAt: "2026-11-18T10:00:00Z",
			}).success,
		).toBe(true);

		const doc = (await generateOpenApiDocument()) as {
			paths: Record<
				string,
				Record<string, { parameters?: { in: string; name: string }[] }>
			>;
		};
		const params = doc.paths["/expenses/{id}"]?.delete?.parameters ?? [];
		expect(
			params.some((p) => p.in === "query" && p.name === "expectedUpdatedAt"),
		).toBe(true);
		expect(expensesContract.delete["~orpc"].route.inputStructure).toBe(
			"detailed",
		);
	});

	it("has a 409 problem code of its own", () => {
		expect(PROBLEM_STATUS.expense_changed).toBe(409);
		expect(
			problemSchema.safeParse({
				type: "urn:retrospend:problem:expense_changed",
				title: "Expense changed",
				status: 409,
				code: "expense_changed",
			}).success,
		).toBe(true);
	});
});
