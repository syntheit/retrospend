/**
 * /api/v1/expenses review fixes on Postgres: stale and reused undo tokens,
 * the web's "no dates means this month" reading of the filter, exact duplicate
 * checks, a previewable and undoable bulk categorize, and previews that need
 * no Idempotency-Key.
 */

import { randomUUID } from "node:crypto";
import { BULK_DELETE_MAX, contract } from "@retrospend/api-contract";
import { dayKey } from "@retrospend/domain/time-zone";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { queryOf, readFilter } from "~/features/activity/filters";
import { createUserScopedDb } from "~/server/db";
import { listExpenses } from "~/server/services/api-v1/expenses";
import { MAX_STORED_RESPONSE_BYTES } from "~/server/services/api-v1/idempotency.service";
import { listActivity } from "~/server/services/expense-list";
import { defaultTimeZone } from "~/server/services/user-time-zone";
import { sealedSuite } from "~/test/pg-harness";
import {
	adminDb,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	fixtureDb,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.expenses;
type Write = { expense: { id: string }; undo: string };
type Page = {
	items: { id: string; title: string }[];
	count: number | null;
	total: { value: { minor: number; currency: string } } | null;
};

// The caller has no stored zone, so days read in the default zone: after 00:00 UTC
// it can still be yesterday there.
const today = () => dayKey(new Date(), defaultTimeZone());

describe("/api/v1/expenses undo, filter and preview rules", () => {
	let userId: string;
	let as: Record<string, string>;
	let food: string;

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
		as = await asMobile(userId);
		food = (await newCategory(userId)).id;
	});

	const newCategory = (user: string, name = "Food") =>
		fixtureDb.category.create({
			data: {
				userId: user,
				name: `${name} ${randomUUID().slice(0, 6)}`,
				color: "teal",
			},
		});
	const body = (categoryId: string, extra: Record<string, unknown> = {}) => ({
		title: "Lunch",
		amount: "12.50",
		currency: "USD",
		date: today(),
		categoryId,
		...extra,
	});
	const post = (path: string, data: unknown, headers = as, key?: string) =>
		call(path, {
			method: "POST",
			headers,
			body: data,
			idempotent: key ?? true,
		});
	const add = async (data: unknown, headers = as) =>
		expectBody<Write>(await post("/expenses", data, headers), c.create, 201);
	const put = async (id: string, data: unknown) =>
		expectBody<Write>(
			await call(`/expenses/${id}`, {
				method: "PUT",
				headers: as,
				body: data,
				idempotent: true,
			}),
			c.update,
		);
	const undo = (token: string) => post("/expenses/undo", { token });

	it("refuses a stale update undo instead of overwriting a newer edit", async () => {
		const made = await add(body(food, { title: "v1", amount: "10" }));
		const id = made.expense.id;
		const first = await put(id, body(food, { title: "v2", amount: "10" }));
		await put(id, body(food, { title: "v3", amount: "10" }));
		await expectProblem(await undo(first.undo), 409, "conflict");
		expect(
			(await fixtureDb.expense.findUniqueOrThrow({ where: { id } })).title,
		).toBe("v3");
	});

	it("refuses to undo the creation of an expense edited since", async () => {
		const made = await add(body(food, { title: "Created" }));
		await put(made.expense.id, body(food, { title: "Edited" }));
		await expectProblem(await undo(made.undo), 409, "conflict");
		await expect(
			fixtureDb.expense.count({ where: { id: made.expense.id } }),
		).resolves.toBe(1);
	});

	it("still undoes the latest edit, and its redo works against that state", async () => {
		const made = await add(body(food, { title: "Before", amount: "10" }));
		const id = made.expense.id;
		const edit = await put(id, body(food, { title: "After", amount: "10" }));
		const undone = await expectBody<{ redo: string }>(
			await undo(edit.undo),
			c.undo,
		);
		expect(
			(await fixtureDb.expense.findUniqueOrThrow({ where: { id } })).title,
		).toBe("Before");
		await expectBody(await undo(undone.redo), c.undo);
		expect(
			(await fixtureDb.expense.findUniqueOrThrow({ where: { id } })).title,
		).toBe("After");
	});

	it("lets an undo token work once", async () => {
		const made = await add(body(food, { title: "Once" }));
		await expectBody(await undo(made.undo), c.undo);
		await expectProblem(await undo(made.undo), 409, "conflict");

		const other = await add(body(food, { title: "Delete once" }));
		const deleted = await expectBody<{ undo: string }>(
			await call(`/expenses/${other.expense.id}`, {
				method: "DELETE",
				headers: as,
				idempotent: true,
			}),
			c.delete,
		);
		await expectBody(await undo(deleted.undo), c.undo);
		await expectProblem(await undo(deleted.undo), 409, "conflict");
		await expect(
			fixtureDb.expense.count({ where: { id: other.expense.id } }),
		).resolves.toBe(1);
	});

	it("frees a token whose undo failed", async () => {
		const made = await add(body(food, { title: "Fails first" }));
		await adminDb.expense.delete({ where: { id: made.expense.id } });
		await expectProblem(await undo(made.undo), 404, "not_found");
		// Not spent: it still fails for the real reason, not "already used".
		await expectProblem(await undo(made.undo), 404, "not_found");
	});

	it("reads no dates as this month like the web, and range=all as every date", async ({
		skip,
	}) => {
		skip(sealedSuite, "PR 5: search reads sealed text without the user's keys");
		const user = (await createTestUser()).user.id;
		const mine = await asMobile(user);
		const cat = (await newCategory(user)).id;
		const [y = 0, m = 1] = today().split("-").map(Number);
		const lastMonth = new Date(Date.UTC(y, m - 2, 15))
			.toISOString()
			.slice(0, 10);
		await add(body(cat, { title: "This month", amount: "8" }), mine);
		await add(
			body(cat, { title: "Last month", amount: "5", date: lastMonth }),
			mine,
		);
		const list = async (filter: string) =>
			expectBody<Page>(
				await call(`/expenses?filter=${encodeURIComponent(filter)}`, {
					headers: mine,
				}),
				c.list,
			);

		const month = await list("kind=expense");
		expect(month.items.map((i) => i.title)).toEqual(["This month"]);

		// The web page's own reading of the same URL gives the same list.
		const web = await listActivity(
			createUserScopedDb(user),
			user,
			{
				...queryOf(readFilter(new URLSearchParams("kind=expense"), today())),
				limit: 50,
			},
			defaultTimeZone(),
		);
		expect(month.items.map((i) => i.id)).toEqual(web.items.map((i) => i.id));
		expect(month.count).toBe(web.count);
		expect(month.total).toEqual(web.total);

		expect((await list("kind=expense&range=all")).items).toHaveLength(2);
		// A category or a search covers every month, as on the web.
		const byCat = await list(`cat=${cat}`);
		expect(byCat.items).toHaveLength(2);
		expect(byCat.total?.value).toEqual({ minor: 1300, currency: "USD" });
		expect((await list("q=month")).items).toHaveLength(2);
		// Explicit dates win.
		expect(
			(await list(`from=${lastMonth}&to=${lastMonth}`)).items.map(
				(i) => i.title,
			),
		).toEqual(["Last month"]);
	});

	it("reads no dates as this month in the caller's zone at a month's end, not the UTC one", async () => {
		const user = (await createTestUser()).user.id;
		const cat = (await newCategory(user)).id;
		await fixtureDb.expense.createMany({
			data: [
				["Oct 31", "2026-10-31"],
				["Nov 1", "2026-11-01"],
			].map(([title, day]) => ({
				userId: user,
				title: title as string,
				amount: "5",
				currency: "USD",
				exchangeRate: "1",
				amountInUSD: "5",
				pricingSource: "MANUAL",
				date: new Date(`${day}T12:00:00.000Z`),
				categoryId: cat,
			})),
		});
		const caller = (timeZone: string) => ({
			db: createUserScopedDb(user),
			principal: { userId: user } as never,
			timeZone,
		});
		const filter = { kinds: ["expense"] } as never;
		const page = { limit: 50 } as never;
		const titles = async (zone: string) =>
			(await listExpenses(caller(zone), filter, page)).items.map(
				(i) => i.title,
			);

		// 00:30 UTC on Nov 1 is still Oct 31 at UTC-3.
		vi.useFakeTimers({ toFake: ["Date"] });
		try {
			vi.setSystemTime(new Date("2026-11-01T00:30:00.000Z"));
			expect(await titles("America/Argentina/Buenos_Aires")).toEqual([
				"Oct 31",
			]);
			expect(await titles("UTC")).toEqual(["Nov 1"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("checks duplicates by the exact amount typed", async () => {
		const user = (await createTestUser()).user.id;
		const mine = await asMobile(user);
		const cat = (await newCategory(user)).id;
		await add(body(cat, { title: "Precise", amount: "0.1" }), mine);
		const ask = async (amount: string) =>
			expectBody<{ duplicate: boolean }>(
				await call(
					`/expenses/duplicates?${new URLSearchParams({ title: "precise", amount, date: today() })}`,
					{ headers: mine },
				),
				c.duplicates,
			);
		expect((await ask("0.1")).duplicate).toBe(true);
		expect((await ask("0.10000001")).duplicate).toBe(false);
	});

	it("previews and undoes a bulk categorize", async () => {
		const from = (await newCategory(userId, "From")).id;
		const to = (await newCategory(userId, "To")).id;
		const one = await add(body(from, { title: "Bulk A" }));
		const two = await add(body(from, { title: "Bulk B" }));
		const input = { ids: [one.expense.id, two.expense.id], categoryId: to };
		const categoryOf = async (id: string) =>
			(await fixtureDb.expense.findUniqueOrThrow({ where: { id } })).categoryId;

		await expectBody(
			await post("/expenses/bulk-category/preview", input),
			c.previewBulkCategory,
		);
		expect(await categoryOf(one.expense.id)).toBe(from);

		const done = await expectBody<{ updated: number; undo: string }>(
			await post("/expenses/bulk-category", input),
			c.bulkCategory,
		);
		expect(done.updated).toBe(2);
		expect(await categoryOf(two.expense.id)).toBe(to);
		await expectBody(await undo(done.undo), c.undo);
		expect(await categoryOf(one.expense.id)).toBe(from);
		expect(await categoryOf(two.expense.id)).toBe(from);
	});

	it("previews a bulk delete in one dry run, deletes the set, and undoes it with one token", async () => {
		const one = await add(body(food, { title: "Gone A", amount: "10" }));
		const two = await add(body(food, { title: "Gone B", amount: "5" }));
		const stranger = await createTestUser();
		const theirs = await add(
			body((await newCategory(stranger.user.id)).id, { title: "Theirs" }),
			await asMobile(stranger.user.id),
		);
		const ids = [one.expense.id, two.expense.id, theirs.expense.id];
		const count = () =>
			fixtureDb.expense.count({
				where: { id: { in: [one.expense.id, two.expense.id] } },
			});

		type Diff = {
			changes: { id: string; delta: { minor: number }; after: unknown }[];
			detail: { kind: string; deleted: number; skipped: string[] };
		};
		const preview = await expectBody<Diff>(
			await post("/expenses/bulk-delete/preview", { ids }),
			c.previewBulkDelete,
		);
		expect(preview.detail).toEqual({
			kind: "expense.deleteMany",
			deleted: 2,
			skipped: [theirs.expense.id],
		});
		const spent = preview.changes.find((x) => x.id === "spent");
		expect(spent?.delta.minor).toBe(-1500);
		expect(spent?.after).not.toBeNull();
		await expect(count()).resolves.toBe(2);

		const done = await expectBody<{
			deleted: number;
			skipped: string[];
			undo: string;
		}>(await post("/expenses/bulk-delete", { ids }), c.bulkDelete);
		expect(done).toMatchObject({ deleted: 2, skipped: [theirs.expense.id] });
		await expect(count()).resolves.toBe(0);
		await expect(
			fixtureDb.expense.count({ where: { id: theirs.expense.id } }),
		).resolves.toBe(1);

		const undone = await expectBody<{ id: string | null; redo: string }>(
			await undo(done.undo),
			c.undo,
		);
		expect(undone.id).toBeNull();
		await expect(count()).resolves.toBe(2);
		await expectProblem(await undo(done.undo), 409, "conflict");

		await expectBody(await undo(undone.redo), c.undo);
		await expect(count()).resolves.toBe(0);
	});

	it("keeps a full bulk delete's response small enough to replay, spread parts and all", async () => {
		const ids: string[] = [];
		for (let i = 0; i < BULK_DELETE_MAX; i++) {
			const made = await add(
				body(food, {
					title: `Spread ${i} ${"x".repeat(200)}`,
					amount: "240",
					amortizeOver: 24,
					description: "y".repeat(900),
					location: "z".repeat(180),
				}),
			);
			ids.push(made.expense.id);
		}
		await expect(
			fixtureDb.expense.count({ where: { parentId: { in: ids } } }),
		).resolves.toBe(BULK_DELETE_MAX * 24);
		const key = randomUUID();
		const first = await post("/expenses/bulk-delete", { ids }, as, key);
		const text = await first.text();
		expect(first.status, text).toBe(200);
		expect(Buffer.byteLength(text, "utf8")).toBeLessThan(
			MAX_STORED_RESPONSE_BYTES,
		);
		// A lost response comes back the same from the same key.
		const again = await post("/expenses/bulk-delete", { ids }, as, key);
		expect(again.status).toBe(200);
		expect(await again.json()).toEqual(JSON.parse(text));

		const done = JSON.parse(text) as { deleted: number; undo: string };
		expect(done.deleted).toBe(BULK_DELETE_MAX);
		await expectBody(await undo(done.undo), c.undo);
		await expect(
			fixtureDb.expense.count({
				where: { OR: [{ id: { in: ids } }, { parentId: { in: ids } }] },
			}),
		).resolves.toBe(BULK_DELETE_MAX * 25);
	}, 120_000);

	it("refuses a bulk delete when none of the ids can go", async () => {
		const stranger = await createTestUser();
		const theirs = await add(
			body((await newCategory(stranger.user.id)).id, { title: "Not mine" }),
			await asMobile(stranger.user.id),
		);
		const input = { ids: [theirs.expense.id] };
		for (const path of [
			"/expenses/bulk-delete/preview",
			"/expenses/bulk-delete",
		])
			await expectProblem(await post(path, input), 400, "bad_request");
		await expect(
			fixtureDb.expense.count({ where: { id: theirs.expense.id } }),
		).resolves.toBe(1);
	});

	it("answers an amount too large for the ledger as a 400, never a 500", async () => {
		const big = body(food, { title: "Huge", amount: "50000000000" });
		for (const path of ["/expenses", "/expenses/preview"]) {
			const res = await post(path, big);
			await expectProblem(res, 400, "validation_failed");
		}
		await expect(
			fixtureDb.expense.count({ where: { userId, title: "Huge" } }),
		).resolves.toBe(0);
		// The largest amount that fits still saves.
		await add(body(food, { title: "Big", amount: "9999999999" }));
	});

	it("lets one key preview and then write, and previews need no key", async () => {
		const key = randomUUID();
		const data = body(food, { title: "Same key", amount: "9" });
		await expectBody(
			await post("/expenses/preview", data, as, key),
			c.previewCreate,
		);
		await expectBody(await post("/expenses", data, as, key), c.create, 201);
		await expectBody(
			await call("/expenses/preview", {
				method: "POST",
				headers: as,
				body: data,
			}),
			c.previewCreate,
		);
	});
});
