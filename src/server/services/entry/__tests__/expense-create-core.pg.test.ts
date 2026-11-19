/**
 * Create through the domain core (slice-device-writes PR1), on every server
 * transport: an amount that stores as 0 is refused with the domain's words
 * (tRPC and legacy; v1's amount text cannot reach it), and createExpenseIn
 * books through bookCreate. ARS home, Blue 1,468 per USD (expense-write-kit).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { seedArsRates } from "~/server/services/accounts/test-fixtures";
import { fixtureDb } from "~/test/pg-harness";
import {
	issues,
	lunch,
	makeWorld,
	OK,
	type Out,
	trpc,
	v1Problem,
	type World,
} from "./expense-write-kit";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

beforeAll(seedArsRates);

let w: World;
beforeAll(async () => {
	w = await makeWorld();
});

const count = () => fixtureDb.expense.count({ where: { userId: w.userId } });

describe("an amount that stores as 0 at the column's 8 decimals", () => {
	const ABOVE_0 = trpc("BAD_REQUEST", "Enter an amount above zero");
	// 9 decimals: past the column, so it stores as 0.00000000. The regex of
	// entry.expense.* takes 12 decimals and legacy takes any positive number.

	it.each(["entry", "legacy"] as const)(
		"%s: BAD_REQUEST Enter an amount above zero, nothing stored",
		async (name) => {
			const before = await count();
			const f = lunch(w, { amount: "0.000000001" });
			expect(await w[name].create(randomUUID(), f)).toEqual(ABOVE_0);
			expect(await count()).toBe(before);
		},
	);

	it("entry: the preview twin refuses the same way", async () => {
		const out = await w.entry.previewCreate?.(
			randomUUID(),
			lunch(w, { amount: "0.000000001" }),
		);
		expect(out).toEqual(ABOVE_0);
	});

	it("entry: a bad category is still the first refusal", async () => {
		const out = await w.entry.create(
			randomUUID(),
			lunch(w, { amount: "0.000000001", categoryId: w.income }),
		);
		expect(out).toEqual(trpc("FORBIDDEN", "Category not found"));
	});

	it("v1 cannot reach it: the amount text is refused first, as before", async () => {
		const out = await w.v1.create(
			randomUUID(),
			lunch(w, { amount: "0.000000001" }),
		);
		expect(out).toMatchObject({
			ok: false,
			status: 400,
			code: "validation_failed",
		});
	});

	it("entry: zero itself is still the input's refusal, not the domain's", async () => {
		const out = (await w.entry.create(
			randomUUID(),
			lunch(w, { amount: "0" }),
		)) as Out;
		expect(out).toEqual(
			issues([
				{
					code: "custom",
					path: ["amount"],
					message: "Enter an amount above zero",
				},
			]),
		);
	});
});

describe("createExpenseIn books through the core", () => {
	it("ARS home at Blue 1,468: USD 10, 20 and 30.01 book 14,680.00, 29,360.00 and 44,054.68", async () => {
		const homes: string[] = [];
		for (const amount of ["10", "20", "30.01"]) {
			const id = randomUUID();
			expect(await w.entry.create(id, lunch(w, { amount }))).toEqual(OK);
			const row = await fixtureDb.expense.findUniqueOrThrow({ where: { id } });
			homes.push(String(row.homeAmount));
		}
		expect(homes).toEqual(["14680", "29360", "44054.68"]);
	});

	it("a category held out of analytics by default is excluded unless the form says otherwise", async () => {
		const held = randomUUID();
		const shown = randomUUID();
		await w.entry.create(held, lunch(w, { categoryId: w.holdByDefault }));
		await w.entry.create(
			shown,
			lunch(w, { categoryId: w.holdByDefault, excludeFromAnalytics: false }),
		);
		const rows = await fixtureDb.expense.findMany({
			where: { id: { in: [held, shown] } },
			select: { id: true, excludeFromAnalytics: true },
		});
		expect(
			Object.fromEntries(rows.map((r) => [r.id, r.excludeFromAnalytics])),
		).toEqual({ [held]: true, [shown]: false });
	});

	it("a bad category answers as before on each transport", async () => {
		const bad = lunch(w, { categoryId: w.income });
		expect(await w.entry.create(randomUUID(), bad)).toEqual(
			trpc("FORBIDDEN", "Category not found"),
		);
		expect(await w.legacy.create(randomUUID(), bad)).toEqual(
			trpc("FORBIDDEN", "Category not found"),
		);
		expect(await w.v1.create(randomUUID(), bad)).toEqual(
			v1Problem(404, "not_found", "Category not found"),
		);
	});
});
