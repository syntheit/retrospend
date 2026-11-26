/**
 * What creating or editing a template refuses, as each transport answers it:
 * a category that is not the person's or is of the other kind, and a first
 * date that is not on the anchor day. These answers moved out of
 * recurring.service.ts into the domain's template rules (recurring-post/
 * template.ts); this file pins them so the move changes nothing a person or
 * an API token sees.
 */
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { fixtureDb, fixtureNameIndex } from "~/test/pg-harness";
import { arsUser, trpcFor, usdTemplate, v1For } from "./recurring-write-kit";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

async function category(userId: string, kind: "EXPENSE" | "INCOME") {
	const name = `${kind} ${Math.random().toString(36).slice(2, 8)}`;
	const row = await fixtureDb.category.create({
		data: {
			userId,
			name,
			color: "teal",
			kind,
			nameIndex: await fixtureNameIndex(userId, name),
		},
	});
	return row.id;
}

const body = (extra: object = {}) => ({
	name: "Rent",
	amount: "100",
	currency: "ARS",
	frequency: "MONTHLY",
	nextDueDate: "2027-01-31",
	...extra,
});

const templates = (userId: string) =>
	fixtureDb.recurringTemplate.count({ where: { userId } });

async function problemOf(res: Response, status: number) {
	const text = await res.text();
	expect(res.status, text).toBe(status);
	return JSON.parse(text) as { code: string; detail?: string };
}

describe("v1 POST /recurring refusals", () => {
	it("another person's category is 403 forbidden and nothing is made", async () => {
		const me = await arsUser();
		const theirs = await category(await arsUser(), "EXPENSE");
		const v1 = await v1For(me);
		const problem = await problemOf(
			await v1("POST", "/recurring", body({ categoryId: theirs })),
			403,
		);
		expect(problem).toMatchObject({
			code: "forbidden",
			detail: "Category not found",
		});
		expect(await templates(me)).toBe(0);
	});

	it("an income category on an expense template, and the reverse, are 403 forbidden", async () => {
		const me = await arsUser();
		const income = await category(me, "INCOME");
		const expense = await category(me, "EXPENSE");
		const v1 = await v1For(me);
		await problemOf(
			await v1("POST", "/recurring", body({ categoryId: income })),
			403,
		);
		await problemOf(
			await v1(
				"POST",
				"/recurring",
				body({ categoryId: expense, direction: "in" }),
			),
			403,
		);
		expect(await templates(me)).toBe(0);
	});

	it("a category of the template's own kind is accepted for each direction", async () => {
		const me = await arsUser();
		const income = await category(me, "INCOME");
		const expense = await category(me, "EXPENSE");
		const v1 = await v1For(me);
		expect(
			(await v1("POST", "/recurring", body({ categoryId: expense }))).status,
		).toBe(201);
		expect(
			(
				await v1(
					"POST",
					"/recurring",
					body({ categoryId: income, direction: "in" }),
				)
			).status,
		).toBe(201);
	});

	it("a first date that is not on the anchor day is 400 bad_request with the message", async () => {
		const me = await arsUser();
		const v1 = await v1For(me);
		const problem = await problemOf(
			await v1("POST", "/recurring", body({ anchorDay: 15 })),
			400,
		);
		expect(problem).toMatchObject({
			code: "bad_request",
			detail: "nextDueDate must fall on anchorDay",
		});
		expect(await templates(me)).toBe(0);
	});

	it("an anchor on a weekly schedule is ignored, and a clamped first date keeps 31", async () => {
		const me = await arsUser();
		const v1 = await v1For(me);
		const weekly = await v1(
			"POST",
			"/recurring",
			body({ frequency: "WEEKLY", anchorDay: 15 }),
		);
		expect(weekly.status).toBe(201);
		const clamped = (await (
			await v1(
				"POST",
				"/recurring",
				body({ nextDueDate: "2027-02-28", anchorDay: 31 }),
			)
		).json()) as { id: string };
		const row = await fixtureDb.recurringTemplate.findUniqueOrThrow({
			where: { id: clamped.id },
		});
		expect(row.anchorDay).toBe(31);
	});
});

describe("v1 PATCH /recurring refusals", () => {
	it("another person's category, or one of the other kind, is 403 and the template is unchanged", async () => {
		const me = await arsUser();
		const id = await usdTemplate(me);
		const theirs = await category(await arsUser(), "EXPENSE");
		const income = await category(me, "INCOME");
		const v1 = await v1For(me);
		for (const categoryId of [theirs, income])
			expect(
				await problemOf(
					await v1("PATCH", `/recurring/${id}`, { categoryId, name: "Moved" }),
					403,
				),
			).toMatchObject({ code: "forbidden", detail: "Category not found" });
		const row = await fixtureDb.recurringTemplate.findUniqueOrThrow({
			where: { id },
		});
		expect(row.name).toBe("Rent");
		expect(row.categoryId).toBeNull();
	});

	it("the category is refused before a stale stamp is compared", async () => {
		const me = await arsUser();
		const id = await usdTemplate(me);
		const income = await category(me, "INCOME");
		const v1 = await v1For(me);
		await problemOf(
			await v1("PATCH", `/recurring/${id}`, {
				categoryId: income,
				expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
			}),
			403,
		);
	});

	it("an expense category on an income template is 403, an income one is kept", async () => {
		const me = await arsUser();
		const id = await usdTemplate(me, { direction: "IN" });
		const expense = await category(me, "EXPENSE");
		const income = await category(me, "INCOME");
		const v1 = await v1For(me);
		await problemOf(
			await v1("PATCH", `/recurring/${id}`, { categoryId: expense }),
			403,
		);
		expect(
			(await v1("PATCH", `/recurring/${id}`, { categoryId: income })).status,
		).toBe(200);
	});
});

describe("the web's tRPC refusals", () => {
	it("create with another person's or the wrong kind of category is FORBIDDEN", async () => {
		const me = await arsUser();
		const caller = await trpcFor(me);
		const theirs = await category(await arsUser(), "EXPENSE");
		const income = await category(me, "INCOME");
		for (const categoryId of [theirs, income]) {
			const error = await caller.recurring
				.create({
					name: "Rent",
					amount: 100,
					currency: "ARS",
					frequency: "MONTHLY",
					nextDueDate: new Date("2027-01-31T12:00:00Z"),
					categoryId,
				})
				.catch((e: unknown) => e);
			expect(error).toBeInstanceOf(TRPCError);
			expect(error).toMatchObject({
				code: "FORBIDDEN",
				message: "Category not found",
			});
		}
		expect(await templates(me)).toBe(0);
	});

	it("update with another person's category is FORBIDDEN", async () => {
		const me = await arsUser();
		const id = await usdTemplate(me);
		const caller = await trpcFor(me);
		const theirs = await category(await arsUser(), "EXPENSE");
		const error = await caller.recurring
			.update({ id, categoryId: theirs })
			.catch((e: unknown) => e);
		expect(error).toMatchObject({
			code: "FORBIDDEN",
			message: "Category not found",
		});
	});
});
