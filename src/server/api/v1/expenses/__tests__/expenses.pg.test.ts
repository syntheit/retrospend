/**
 * /api/v1/expenses on Postgres: the Activity list with the filter grammar,
 * every write with its preview twin, undo tokens, idempotent replay, and
 * one user never reaching another's entries. Requests go through the same
 * handler the Next route uses, so RLS, scopes and idempotency are real.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	adminDb,
	asKey,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	useApiV1,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.expenses;

type Expense = {
	id: string;
	title: string;
	amount: { minor: number; currency: string };
	home: { minor: number; currency: string } | null;
	date: string;
	categoryId: string | null;
	amortizeOver: number | null;
};
type Write = { expense: Expense; undo: string };
type Page = {
	items: { id: string; title: string; kind: string }[];
	nextCursor: string | null;
	count: number | null;
	total: { figure: string; value: { minor: number; currency: string } } | null;
};
type Preview = {
	changes: { id: string; delta: { minor: number; currency: string } }[];
	unchanged: { id: string }[];
};

const today = () => new Date().toISOString().slice(0, 10);

async function category(userId: string, name = "Food") {
	return adminDb.category.create({
		data: { userId, name: `${name} ${randomUUID().slice(0, 6)}`, color: "teal" },
	});
}

const body = (categoryId: string, extra: Record<string, unknown> = {}) => ({
	title: "Lunch",
	amount: "12.50",
	currency: "USD",
	date: today(),
	categoryId,
	...extra,
});

describe("/api/v1/expenses", () => {
	useApiV1();
	let alice: string;
	let bob: string;
	let asAlice: Record<string, string>;
	let asBob: Record<string, string>;
	let food: string;

	beforeAll(async () => {
		alice = (await createTestUser()).user.id;
		bob = (await createTestUser()).user.id;
		asAlice = await asMobile(alice);
		asBob = await asMobile(bob);
		food = (await category(alice)).id;
	});

	const create = (headers: Record<string, string>, data: unknown, key?: string) =>
		call("/expenses", {
			method: "POST",
			headers,
			body: data,
			idempotent: key ?? true,
		});

	const add = async (data: unknown, headers = asAlice) =>
		expectBody<Write>(await create(headers, data), c.create, 201);

	it("creates an expense and reads it back with Money", async () => {
		const made = await add(body(food, { description: "Menu of the day" }));
		expect(made.expense).toMatchObject({
			title: "Lunch",
			amount: { minor: 1250, currency: "USD" },
			home: null,
			kind: "expense",
			date: today(),
			categoryId: food,
			amortizeOver: null,
		});
		expect(made.undo.length).toBeGreaterThan(20);
		const got = await expectBody<Expense>(
			await call(`/expenses/${made.expense.id}`, { headers: asAlice }),
			c.get,
		);
		expect(got.id).toBe(made.expense.id);
	});

	it("books a foreign expense at a typed rate and returns the home value", async () => {
		const made = await add(
			body(food, {
				title: "Kiosk",
				amount: "15000",
				currency: "ARS",
				customRate: "0.00068",
			}),
		);
		expect(made.expense.amount).toEqual({ minor: 1_500_000, currency: "ARS" });
		// 15000 ARS x 0.00068 = USD 10.20, booked once.
		expect(made.expense.home).toEqual({ minor: 1020, currency: "USD" });
	});

	it("refuses money sent as a JSON number", async () => {
		await expectProblem(
			await create(asAlice, body(food, { amount: 12.5 })),
			400,
			"validation_failed",
		);
		await expectProblem(
			await create(asAlice, body(food, { amount: "0" })),
			400,
			"validation_failed",
		);
	});

	it("replays a create with the same key and writes once", async () => {
		const key = randomUUID();
		const data = body(food, { title: "Replay me" });
		const first = await create(asAlice, data, key);
		const second = await create(asAlice, data, key);
		expect(second.headers.get("idempotent-replayed")).toBe("true");
		expect(await second.json()).toEqual(await first.json());
		await expect(
			adminDb.expense.count({ where: { userId: alice, title: "Replay me" } }),
		).resolves.toBe(1);
		await expectProblem(
			await create(asAlice, body(food, { title: "Other body" }), key),
			422,
			"idempotency_key_reused",
		);
		await expectProblem(
			await call("/expenses", {
				method: "POST",
				headers: asAlice,
				body: data,
			}),
			400,
			"idempotency_key_required",
		);
	});

	it("takes a client id once", async () => {
		const id = randomUUID();
		const made = await add(body(food, { id, title: "Mine" }));
		expect(made.expense.id).toBe(id);
		await expectProblem(
			await create(asAlice, body(food, { id, title: "Again" })),
			409,
			"conflict",
		);
	});

	it("previews a create without writing, and the preview equals the result", async () => {
		const before = await adminDb.expense.count({ where: { userId: alice } });
		const data = body(food, { title: "Preview me", amount: "40" });
		const preview = await expectBody<Preview>(
			await call("/expenses/preview", {
				method: "POST",
				headers: asAlice,
				body: data,
				idempotent: true,
			}),
			c.previewCreate,
		);
		expect(
			await adminDb.expense.count({ where: { userId: alice } }),
		).toBe(before);
		const spent = preview.changes.find((x) => x.id === "spent");
		expect(spent?.delta).toEqual({ minor: 4000, currency: "USD" });
	});

	it("replaces an expense, previews it, and undoes it", async () => {
		const made = await add(body(food, { title: "Before", amount: "10" }));
		const id = made.expense.id;
		const next = {
			title: "After",
			amount: "25",
			currency: "USD",
			date: today(),
			categoryId: food,
		};
		const preview = await expectBody<Preview>(
			await call(`/expenses/${id}/preview`, {
				method: "POST",
				headers: asAlice,
				body: next,
				idempotent: true,
			}),
			c.previewUpdate,
		);
		expect(preview.changes.find((x) => x.id === "spent")?.delta).toEqual({
			minor: 1500,
			currency: "USD",
		});
		expect(
			(await adminDb.expense.findUniqueOrThrow({ where: { id } })).title,
		).toBe("Before");

		const done = await expectBody<Write>(
			await call(`/expenses/${id}`, {
				method: "PUT",
				headers: asAlice,
				body: next,
				idempotent: true,
			}),
			c.update,
		);
		expect(done.expense).toMatchObject({
			title: "After",
			amount: { minor: 2500, currency: "USD" },
		});

		const undone = await expectBody<{ id: string; redo: string }>(
			await call("/expenses/undo", {
				method: "POST",
				headers: asAlice,
				body: { token: done.undo },
				idempotent: true,
			}),
			c.undo,
		);
		expect(undone.id).toBe(id);
		const row = await adminDb.expense.findUniqueOrThrow({ where: { id } });
		expect(row.title).toBe("Before");
		expect(row.amount.toString()).toBe("10");

		// The redo puts the edit back.
		await expectBody(
			await call("/expenses/undo", {
				method: "POST",
				headers: asAlice,
				body: { token: undone.redo },
				idempotent: true,
			}),
			c.undo,
		);
		expect(
			(await adminDb.expense.findUniqueOrThrow({ where: { id } })).title,
		).toBe("After");
	});

	it("deletes with a preview, and its undo brings the same expense back", async () => {
		const made = await add(body(food, { title: "Gone soon", amount: "7" }));
		const id = made.expense.id;
		const preview = await expectBody<Preview>(
			await call(`/expenses/${id}/delete/preview`, {
				method: "POST",
				headers: asAlice,
				body: {},
				idempotent: true,
			}),
			c.previewDelete,
		);
		expect(preview.changes.find((x) => x.id === "spent")?.delta).toEqual({
			minor: -700,
			currency: "USD",
		});
		await expect(
			adminDb.expense.count({ where: { id } }),
		).resolves.toBe(1);

		const deleted = await expectBody<{ id: string; undo: string }>(
			await call(`/expenses/${id}`, {
				method: "DELETE",
				headers: asAlice,
				idempotent: true,
			}),
			c.delete,
		);
		await expect(adminDb.expense.count({ where: { id } })).resolves.toBe(0);

		const undo = await call("/expenses/undo", {
			method: "POST",
			headers: asAlice,
			body: { token: deleted.undo },
			idempotent: true,
		});
		await expectBody(undo, c.undo);
		const back = await adminDb.expense.findUniqueOrThrow({ where: { id } });
		expect(back.title).toBe("Gone soon");
		expect(back.amount.toString()).toBe("7");
	});

	it("undoes a create by deleting it, and previews the undo", async () => {
		const made = await add(body(food, { title: "Oops", amount: "3" }));
		const preview = await expectBody<Preview>(
			await call("/expenses/undo/preview", {
				method: "POST",
				headers: asAlice,
				body: { token: made.undo },
				idempotent: true,
			}),
			c.previewUndo,
		);
		expect(preview.changes.find((x) => x.id === "spent")?.delta).toEqual({
			minor: -300,
			currency: "USD",
		});
		await expectBody(
			await call("/expenses/undo", {
				method: "POST",
				headers: asAlice,
				body: { token: made.undo },
				idempotent: true,
			}),
			c.undo,
		);
		await expect(
			adminDb.expense.count({ where: { id: made.expense.id } }),
		).resolves.toBe(0);
	});

	it("keeps an undo token to its owner and refuses garbage", async () => {
		const made = await add(body(food, { title: "Mine only" }));
		const bobsTry = await call("/expenses/undo", {
			method: "POST",
			headers: asBob,
			body: { token: made.undo },
			idempotent: true,
		});
		await expectProblem(bobsTry, 400, "bad_request");
		await expect(
			adminDb.expense.count({ where: { id: made.expense.id } }),
		).resolves.toBe(1);
		for (const token of ["nope", `${made.undo}x`, "a.b.c"])
			await expectProblem(
				await call("/expenses/undo", {
					method: "POST",
					headers: asAlice,
					body: { token },
					idempotent: true,
				}),
				400,
				"bad_request",
			);
	});

	it("answers 404 for another user's expense on every route", async () => {
		const made = await add(body(food, { title: "Alice private" }));
		const id = made.expense.id;
		const data = body(food);
		await expectProblem(
			await call(`/expenses/${id}`, { headers: asBob }),
			404,
			"not_found",
		);
		for (const [method, path, bodyOf] of [
			["PUT", `/expenses/${id}`, data],
			["POST", `/expenses/${id}/preview`, data],
			["DELETE", `/expenses/${id}`, undefined],
			["POST", `/expenses/${id}/delete/preview`, {}],
		] as const)
			await expectProblem(
				await call(path, {
					method,
					headers: asBob,
					body: bodyOf,
					idempotent: true,
				}),
				404,
				"not_found",
			);
		await expect(
			adminDb.expense.count({ where: { id, title: "Alice private" } }),
		).resolves.toBe(1);
	});

	it("lists newest first with the filter grammar, a cursor, and totals", async () => {
		const user = (await createTestUser()).user.id;
		const as = await asMobile(user);
		const cat = (await category(user, "Coffee")).id;
		const other = (await category(user, "Rent")).id;
		for (const [title, cid, amount] of [
			["Café Martínez", cat, "4"],
			["Cafe Bar", cat, "6"],
			["Rent", other, "500"],
		] as const)
			await add(body(cid, { title, amount }), as);

		const all = await expectBody<Page>(
			await call("/expenses?filter=range%3Dall", { headers: as }),
			c.list,
		);
		expect(all.items.map((i) => i.title).sort()).toEqual([
			"Cafe Bar",
			"Café Martínez",
			"Rent",
		]);
		expect(all.count).toBe(3);
		expect(all.total?.value).toEqual({ minor: 51_000, currency: "USD" });

		// Accent-insensitive search, and a category filter.
		const search = await expectBody<Page>(
			await call(`/expenses?filter=${encodeURIComponent("q=cafe")}`, {
				headers: as,
			}),
			c.list,
		);
		expect(search.items).toHaveLength(2);
		// spent() cannot express a text search, so there is no total, not a wrong one.
		expect(search.total).toBeNull();
		const byCat = await expectBody<Page>(
			await call(
				`/expenses?filter=${encodeURIComponent(`cat=${other}`)}`,
				{ headers: as },
			),
			c.list,
		);
		expect(byCat.items.map((i) => i.title)).toEqual(["Rent"]);
		expect(byCat.total?.value).toEqual({ minor: 50_000, currency: "USD" });

		// Paging by cursor visits each entry once.
		const seen: string[] = [];
		let cursor: string | null = null;
		do {
			const qs: string = cursor ? `&cursor=${cursor}` : "";
			const page: Page = await expectBody<Page>(
				await call(`/expenses?limit=2${qs}`, { headers: as }),
				c.list,
			);
			seen.push(...page.items.map((i) => i.id));
			cursor = page.nextCursor;
		} while (cursor);
		expect(new Set(seen).size).toBe(3);

		await expectProblem(
			await call("/expenses?cursor=not-ours", { headers: as }),
			400,
			"bad_request",
		);
	});

	it("refuses a filter it cannot read, never ignoring it", async () => {
		for (const filter of ["kind=gift", "from=yesterday", "nope=1", "q="])
			await expectProblem(
				await call(`/expenses?filter=${encodeURIComponent(filter)}`, {
					headers: asAlice,
				}),
				400,
				"invalid_filter",
			);
	});

	it("never lists another user's entries", async () => {
		const page = await expectBody<Page>(
			await call("/expenses?filter=range%3Dall&limit=200", { headers: asBob }),
			c.list,
		);
		expect(page.items).toHaveLength(0);
	});

	it("categorizes in bulk, skipping ids that are not yours", async () => {
		const target = (await category(alice, "Bulk")).id;
		const mine = await add(body(food, { title: "Bulk 1" }));
		const bobs = await add(body((await category(bob)).id), asBob);
		const res = await expectBody<{ updated: number }>(
			await call("/expenses/bulk-category", {
				method: "POST",
				headers: asAlice,
				body: { ids: [mine.expense.id, bobs.expense.id], categoryId: target },
				idempotent: true,
			}),
			c.bulkCategory,
		);
		expect(res.updated).toBe(1);
		expect(
			(await adminDb.expense.findUniqueOrThrow({ where: { id: mine.expense.id } }))
				.categoryId,
		).toBe(target);
		expect(
			(await adminDb.expense.findUniqueOrThrow({ where: { id: bobs.expense.id } }))
				.categoryId,
		).not.toBe(target);

		await expectProblem(
			await call("/expenses/bulk-category", {
				method: "POST",
				headers: asAlice,
				body: { ids: [mine.expense.id], categoryId: "nope" },
				idempotent: true,
			}),
			403,
			"forbidden",
		);
	});

	it("checks duplicates and suggests titles", async () => {
		const user = (await createTestUser()).user.id;
		const as = await asMobile(user);
		const cat = (await category(user)).id;
		await add(body(cat, { title: "Gym membership", amount: "30" }), as);
		const q = new URLSearchParams({
			title: "gym MEMBERSHIP",
			amount: "30",
			date: today(),
		});
		const dup = await expectBody<{ duplicate: boolean; expenseId: string | null }>(
			await call(`/expenses/duplicates?${q}`, { headers: as }),
			c.duplicates,
		);
		expect(dup.duplicate).toBe(true);
		const none = await expectBody<{ duplicate: boolean }>(
			await call(`/expenses/duplicates?${new URLSearchParams({ title: "Gym", amount: "31", date: today() })}`, {
				headers: as,
			}),
			c.duplicates,
		);
		expect(none.duplicate).toBe(false);

		const suggestions = await expectBody<{
			items: { title: string; lastCategoryId: string | null; lastAmount: unknown }[];
		}>(
			await call("/expenses/title-suggestions?q=gym", { headers: as }),
			c.titleSuggestions,
		);
		expect(suggestions.items[0]).toMatchObject({
			title: "Gym membership",
			lastCategoryId: cat,
			lastAmount: { minor: 3000, currency: "USD" },
		});
	});

	it("needs the right scope for reads and writes", async () => {
		const readOnly = await asKey(alice, ["read"]);
		await expectBody(await call("/expenses?limit=1", { headers: readOnly }), c.list);
		await expectProblem(
			await create(readOnly, body(food)),
			403,
			"missing_scope",
		);
		const writer = await asKey(alice, ["write:expenses"]);
		await expectProblem(
			await call("/expenses?limit=1", { headers: writer }),
			403,
			"missing_scope",
		);
	});
});
