/**
 * A phone sees a category merge, and its undo, through the real v1 sync
 * routes: the device store is filled by the engine's own pull driver
 * (parity/pull.ts), the merge and the undo are the server's money writes, and
 * the second pull of each must leave the store as the database is. Also a
 * phone write that still names the deleted id: it is answered with the
 * category-not-found code (404 not_found on a write), which the outbox parks
 * and keeps, never loses (apps/mobile classify, sendChange.test.ts).
 *
 * The user's home is ARS and the rows are booked at blue (1 USD = 1,545 ARS);
 * the pulled rows are compared to the rows written here, not to a pull.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	asMobile,
	call,
	expectBody,
	expectProblem,
} from "~/server/api/v1/core/__tests__/harness";
import {
	arsUser,
	BLUE,
	category,
	expense,
	run,
	templateOf,
	undo,
} from "~/server/services/category/__tests__/merge-kit";
import {
	seedUser,
	setupInput,
} from "~/server/services/envelope/__tests__/pg-fixture";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import { forUser } from "~/server/services/preview";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import { type Device, expectedCounts, newDevice, pullAll } from "./pull";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

// A peso home needs a peso rate on the table for a budget book's starting
// balance and for a USD write; the booked rows carry their own blue rate.
beforeAll(async () => {
	const today = new Date(
		`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
	);
	for (const type of ["official", "blue"])
		await adminDb.exchangeRate.upsert({
			where: { date_currency_type: { date: today, currency: "ARS", type } },
			create: { date: today, currency: "ARS", type, rate: String(BLUE) },
			update: { rate: String(BLUE) },
		});
});

/** Pulls until the device holds what the database holds, without the shares snapshot. */
async function catchUp(device: Device) {
	await pullAll(device, await expectedCounts(device.userId), {
		shares: false,
	});
}

const categoriesOf = (d: Device) =>
	new Map(d.store.list("categories").map((c) => [c.id, c]));
const expensesOf = (d: Device) =>
	new Map(d.store.list("expenses").map((e) => [e.id, e]));

/** A person with a budget book (Rent and Dining envelopes, each with its category) and ARS as home. */
async function bookUser() {
	const s = await seedUser();
	await adminDb.user.update({
		where: { id: s.user.id },
		data: { homeCurrency: "ARS" },
	});
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		timeZone: "UTC",
	});
	return s;
}

describe("a phone sees a category merge and its undo", () => {
	it("a device that pulled before sees the category go and the rows move, then everything come back", async () => {
		const s = await bookUser();
		const me = s.user.id;
		// Dining goes into Rent: both linked, in different envelopes of one book.
		const lunch = await expense(me, s.dining, 10);
		const rentRow = await expense(me, s.rent, 4);
		const gym = await templateOf(me, s.dining);
		const device = await newDevice(me);
		await catchUp(device);

		expect(categoriesOf(device).has(s.dining)).toBe(true);
		expect(expensesOf(device).get(lunch.id)).toMatchObject({
			categoryId: s.dining,
			categoryKind: "EXPENSE",
		});
		const linkOf = (id: string) =>
			device.store
				.list("envelopeCategories")
				.filter((l) => l.categoryId === id);
		expect(linkOf(s.dining)).toHaveLength(1);

		const merged = await run(me, s.dining, s.rent);
		await catchUp(device);

		// The category is gone from the device and its rows are on the target.
		expect(categoriesOf(device).has(s.dining)).toBe(false);
		expect(categoriesOf(device).has(s.rent)).toBe(true);
		expect(expensesOf(device).get(lunch.id)).toMatchObject({
			categoryId: s.rent,
			categoryKind: "EXPENSE",
		});
		expect(expensesOf(device).get(rentRow.id)?.categoryId).toBe(s.rent);
		expect(
			device.store.list("recurringTemplates").find((t) => t.id === gym.id),
		).toMatchObject({
			categoryId: s.rent,
			category: expect.objectContaining({ id: s.rent, name: "Rent" }),
		});
		// The source's envelope link went with it (the target's own stays).
		expect(linkOf(s.dining)).toHaveLength(0);
		expect(linkOf(s.rent)).toHaveLength(1);

		await undo(me, merged.value.stash);
		await catchUp(device);

		// The category is back with its id, name and kind; the rows are re-categorized.
		expect(categoriesOf(device).get(s.dining)).toMatchObject({
			id: s.dining,
			name: "Dining",
			kind: "EXPENSE",
		});
		expect(expensesOf(device).get(lunch.id)).toMatchObject({
			categoryId: s.dining,
			categoryKind: "EXPENSE",
		});
		expect(expensesOf(device).get(rentRow.id)?.categoryId).toBe(s.rent);
		expect(
			device.store.list("recurringTemplates").find((t) => t.id === gym.id),
		).toMatchObject({
			categoryId: s.dining,
			category: expect.objectContaining({ id: s.dining, name: "Dining" }),
		});
		expect(linkOf(s.dining)).toHaveLength(1);
		expect(linkOf(s.rent)).toHaveLength(1);
	});

	it("a device that never saw the delete ends with the category as it was", async () => {
		const me = await arsUser();
		const cafe = await category(me, "Cafe");
		const food = await category(me, "Food");
		const row = await expense(me, cafe.id, 4);
		const device = await newDevice(me);
		await catchUp(device);

		const merged = await run(me, cafe.id, food.id);
		await undo(me, merged.value.stash);
		// The delete's stamp became a live stamp again: the category arrives as a change.
		await catchUp(device);
		expect(categoriesOf(device).get(cafe.id)).toMatchObject({
			name: "Cafe",
			kind: "EXPENSE",
		});
		expect(expensesOf(device).get(row.id)?.categoryId).toBe(cafe.id);

		// And a device that starts after the undo reads the same.
		const fresh = await newDevice(me);
		await catchUp(fresh);
		expect(categoriesOf(fresh).get(cafe.id)?.name).toBe("Cafe");
		expect(expensesOf(fresh).get(row.id)?.categoryId).toBe(cafe.id);
	});

	it("an income category keeps its kind through the merge and the undo", async () => {
		const me = await arsUser();
		const pay = await category(me, "Pay", { kind: "INCOME" });
		const gigs = await category(me, "Gigs", { kind: "INCOME" });
		const row = await expense(me, gigs.id, 20, {
			direction: "IN",
			inType: "INCOME",
		});
		const device = await newDevice(me);
		await catchUp(device);
		expect(expensesOf(device).get(row.id)?.categoryKind).toBe("INCOME");

		const merged = await run(me, gigs.id, pay.id);
		await catchUp(device);
		expect(categoriesOf(device).has(gigs.id)).toBe(false);
		expect(expensesOf(device).get(row.id)).toMatchObject({
			categoryId: pay.id,
			categoryKind: "INCOME",
		});

		await undo(me, merged.value.stash);
		await catchUp(device);
		expect(categoriesOf(device).get(gigs.id)?.kind).toBe("INCOME");
		expect(expensesOf(device).get(row.id)).toMatchObject({
			categoryId: gigs.id,
			categoryKind: "INCOME",
		});
	});
});

describe("a phone write that names the deleted category", () => {
	const c = contract.expenses;
	let me: string;
	let as: Record<string, string>;
	let gone: string;
	let kept: string;
	let target: string;

	beforeAll(async () => {
		me = await arsUser();
		as = await asMobile(me);
		const source = await category(me, "Gone");
		target = (await category(me, "Target")).id;
		gone = source.id;
		kept = (await expense(me, source.id, 3)).id;
		await run(me, source.id, target);
	});

	const body = (categoryId: string) => ({
		title: "Late write",
		amount: "12.50",
		currency: "USD",
		date: new Date().toISOString().slice(0, 10),
		categoryId,
	});

	it("is answered not_found on create and on replace, and nothing is written", async () => {
		const before = await fixtureDb.expense.count({ where: { userId: me } });
		await expectProblem(
			await call("/expenses", {
				method: "POST",
				headers: as,
				body: body(gone),
				idempotent: randomUUID(),
			}),
			404,
			"not_found",
		);
		await expectProblem(
			await call(`/expenses/${kept}`, {
				method: "PUT",
				headers: as,
				body: body(gone),
				idempotent: randomUUID(),
			}),
			404,
			"not_found",
		);
		expect(await fixtureDb.expense.count({ where: { userId: me } })).toBe(
			before,
		);
		await expect(
			fixtureDb.expense.findUniqueOrThrow({ where: { id: kept } }),
		).resolves.toMatchObject({ categoryId: target });
	});

	it("is answered forbidden on a bulk categorize, and the row keeps its category", async () => {
		await expectProblem(
			await call("/expenses/bulk-category", {
				method: "POST",
				headers: as,
				body: { ids: [kept], categoryId: gone },
				idempotent: randomUUID(),
			}),
			403,
			"forbidden",
		);
		await expect(
			fixtureDb.expense.findUniqueOrThrow({ where: { id: kept } }),
		).resolves.toMatchObject({ categoryId: target });
	});

	it("is accepted again once the undo brings the category back", async () => {
		const source = await category(me, "Back soon");
		const merged = await run(me, source.id, target);
		await undo(me, merged.value.stash);
		const made = await expectBody<{ expense: { categoryId: string } }>(
			await call("/expenses", {
				method: "POST",
				headers: as,
				body: body(source.id),
				idempotent: randomUUID(),
			}),
			c.create,
			201,
		);
		expect(made.expense.categoryId).toBe(source.id);
	});
});
