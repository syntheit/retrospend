import { describe, expect, it } from "vitest";
import { PROBLEM_STATUS, problemSchema } from "../common/errors";
import { generateOpenApiDocument } from "../openapi";
import {
	confirmRecurringSchema,
	createRecurringSchema,
	recurringConfirmResultSchema,
	recurringSkipResultSchema,
	skipRecurringSchema,
	updateRecurringSchema,
} from "./index";

const STAMP = "2026-11-18T10:00:00.000Z";
const CLIENT_ID = "0b1f6d6e-3c1a-4f1e-9a57-5c1f4d3a2b10";

describe("template stamps and client ids on recurring writes", () => {
	it("are optional on every request and must be a timestamp or a uuid", () => {
		expect(confirmRecurringSchema.safeParse({ id: "t1" }).success).toBe(true);
		expect(
			confirmRecurringSchema.safeParse({
				id: "t1",
				expenseId: CLIENT_ID,
				expectedUpdatedAt: STAMP,
			}).success,
		).toBe(true);
		expect(
			confirmRecurringSchema.safeParse({ id: "t1", expenseId: "not-a-uuid" })
				.success,
		).toBe(false);
		expect(
			confirmRecurringSchema.safeParse({ id: "t1", expectedUpdatedAt: "x" })
				.success,
		).toBe(false);
		const skip = { id: "t1", dueAt: STAMP };
		expect(skipRecurringSchema.safeParse(skip).success).toBe(true);
		expect(
			skipRecurringSchema.safeParse({ ...skip, expectedUpdatedAt: STAMP })
				.success,
		).toBe(true);
		expect(updateRecurringSchema.safeParse({ id: "t1" }).success).toBe(true);
		expect(
			updateRecurringSchema.safeParse({ id: "t1", expectedUpdatedAt: STAMP })
				.success,
		).toBe(true);
		const create = {
			name: "Rent",
			amount: "20",
			currency: "USD",
			frequency: "MONTHLY",
			nextDueDate: "2026-12-01",
		};
		expect(createRecurringSchema.safeParse(create).success).toBe(true);
		expect(
			createRecurringSchema.safeParse({ ...create, id: CLIENT_ID }).success,
		).toBe(true);
		expect(
			createRecurringSchema.safeParse({ ...create, id: "t1" }).success,
		).toBe(false);
	});

	it("come back as templateUpdatedAt on a confirm and a skip", () => {
		expect(recurringSkipResultSchema.shape.templateUpdatedAt).toBeDefined();
		expect(recurringConfirmResultSchema.shape.templateUpdatedAt).toBeDefined();
	});

	it("a confirm may name the expense's own updatedAt: null for income, absent from an older server", () => {
		const base = {
			expenseId: "e1",
			templateId: "t1",
			direction: "out",
			nextDueAt: null,
			booked: null,
			account: null,
			kept: null,
			plan: null,
			templateUpdatedAt: "2026-12-01T12:00:00.000Z",
		};
		const parse = (extra: object) =>
			recurringConfirmResultSchema.safeParse({ ...base, ...extra });
		expect(
			parse({ expenseUpdatedAt: "2026-12-01T12:00:00.000Z" }).success,
		).toBe(true);
		expect(parse({ expenseUpdatedAt: null }).success).toBe(true);
		expect(parse({}).success).toBe(true);
		expect(parse({ expenseUpdatedAt: "yesterday" }).success).toBe(false);
	});

	it("have a 409 problem code of their own", () => {
		expect(PROBLEM_STATUS.recurring_changed).toBe(409);
		expect(
			problemSchema.safeParse({
				type: "urn:retrospend:problem:recurring_changed",
				title: "Recurring expense changed",
				status: 409,
				code: "recurring_changed",
			}).success,
		).toBe(true);
	});

	it("reach the OpenAPI document on the confirm body", async () => {
		const doc = (await generateOpenApiDocument()) as {
			info: { version: string };
			paths: Record<
				string,
				Record<
					string,
					{
						requestBody?: {
							content: {
								"application/json": {
									schema: { properties?: Record<string, unknown> };
								};
							};
						};
					}
				>
			>;
		};
		expect(doc.info.version).toBe("1.16.0");
		const body = (path: string) =>
			Object.keys(
				doc.paths[path]?.post?.requestBody?.content["application/json"].schema
					.properties ?? {},
			);
		for (const path of [
			"/recurring/{id}/confirm",
			"/recurring/{id}/confirm/preview",
		])
			expect(body(path)).toEqual(
				expect.arrayContaining(["expenseId", "expectedUpdatedAt"]),
			);
		expect(body("/recurring/{id}/skip")).toContain("expectedUpdatedAt");
		expect(body("/recurring")).toContain("id");
	});
});
