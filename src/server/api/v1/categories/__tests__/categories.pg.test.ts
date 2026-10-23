/**
 * /api/v1/categories on Postgres: CRUD, merge and delete move what they
 * should, pages follow their cursors, writes replay once, and one user can
 * never reach another's categories.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	adminDb,
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

const c = contract.categories;
type Category = { id: string; name: string; expenseCount: number };

async function expense(userId: string, categoryId: string | null) {
	return adminDb.expense.create({
		data: {
			userId,
			title: "Lunch",
			amount: "12.50",
			currency: "USD",
			date: new Date("2026-10-01T12:00:00Z"),
			categoryId,
			amountInUSD: "12.50",
			exchangeRate: "1",
			pricingSource: "official",
		},
	});
}

describe("/api/v1/categories", () => {
	useApiV1();
	let alice: string;
	let bob: string;
	let asAlice: Record<string, string>;
	let asBob: Record<string, string>;

	beforeAll(async () => {
		alice = (await createTestUser()).user.id;
		bob = (await createTestUser()).user.id;
		asAlice = await asMobile(alice);
		asBob = await asMobile(bob);
	});

	const create = (
		headers: Record<string, string>,
		name: string,
		key?: string,
	) =>
		call("/categories", {
			method: "POST",
			headers,
			body: { name, color: "teal" },
			idempotent: key ?? true,
		});

	it("creates, reads, renames and lists by name", async () => {
		const made = await expectBody<Category>(
			await create(asAlice, "Rent"),
			c.create,
			201,
		);
		expect(made).toMatchObject({ name: "Rent", expenseCount: 0, icon: null });

		const got = await expectBody<Category>(
			await call(`/categories/${made.id}`, { headers: asAlice }),
			c.get,
		);
		expect(got.id).toBe(made.id);

		const renamed = await expectBody<Category>(
			await call(`/categories/${made.id}`, {
				method: "PATCH",
				headers: asAlice,
				body: { name: "Housing", icon: "house" },
				idempotent: true,
			}),
			c.update,
		);
		expect(renamed).toMatchObject({
			name: "Housing",
			icon: "house",
			color: "teal",
		});

		await expectProblem(await create(asAlice, "Housing"), 409, "conflict");
	});

	it("pages by name with an opaque cursor", async () => {
		const user = (await createTestUser()).user.id;
		const as = await asMobile(user);
		for (const name of ["Delta", "Alpha", "Charlie", "Bravo", "Echo"])
			await create(as, name);
		const names: string[] = [];
		let cursor: string | null = null;
		do {
			const qs: string = cursor ? `&cursor=${cursor}` : "";
			const page: { items: Category[]; nextCursor: string | null } =
				await expectBody(
					await call(`/categories?limit=2${qs}`, { headers: as }),
					c.list,
				);
			names.push(...page.items.map((x) => x.name));
			cursor = page.nextCursor;
		} while (cursor);
		expect(names).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);

		await expectProblem(
			await call("/categories?cursor=not-ours", { headers: as }),
			400,
			"bad_request",
		);
	});

	it("replays a create with the same key and writes once", async () => {
		const key = randomUUID();
		const first = await create(asAlice, "Travel", key);
		const second = await create(asAlice, "Travel", key);
		expect(second.headers.get("idempotent-replayed")).toBe("true");
		expect(await second.json()).toEqual(await first.json());
		await expect(
			adminDb.category.count({ where: { userId: alice, name: "Travel" } }),
		).resolves.toBe(1);
	});

	it("refuses to delete a category with expenses unless told to uncategorize", async () => {
		const cat = await expectBody<Category>(
			await create(asAlice, "Snacks"),
			c.create,
			201,
		);
		const spent = await expense(alice, cat.id);

		await expectProblem(
			await call(`/categories/${cat.id}`, {
				method: "DELETE",
				headers: asAlice,
				idempotent: true,
			}),
			409,
			"conflict",
		);
		await expectBody(
			await call(`/categories/${cat.id}`, {
				method: "DELETE",
				headers: asAlice,
				body: { uncategorize: true },
				idempotent: true,
			}),
			c.delete,
		);
		const after = await adminDb.expense.findUniqueOrThrow({
			where: { id: spent.id },
		});
		expect(after.categoryId).toBeNull();
		await expect(
			adminDb.category.count({ where: { id: cat.id } }),
		).resolves.toBe(0);
	});

	it("merges expenses, recurring and budgets into the target", async () => {
		const from = await expectBody<Category>(
			await create(asAlice, "Cafe"),
			c.create,
			201,
		);
		const into = await expectBody<Category>(
			await create(asAlice, "Food"),
			c.create,
			201,
		);
		await expense(alice, from.id);
		await expense(alice, from.id);
		const october = new Date("2026-10-01T00:00:00Z");
		const november = new Date("2026-11-01T00:00:00Z");
		await adminDb.budget.createMany({
			data: [
				{ userId: alice, categoryId: from.id, period: october, amount: "50" },
				{ userId: alice, categoryId: from.id, period: november, amount: "60" },
				{ userId: alice, categoryId: into.id, period: october, amount: "200" },
			],
		});
		await adminDb.recurringTemplate.create({
			data: {
				userId: alice,
				name: "Coffee club",
				amount: "9.99",
				categoryId: from.id,
				frequency: "MONTHLY",
				nextDueDate: november,
			},
		});

		const merged = await expectBody<Category>(
			await call(`/categories/${from.id}/merge`, {
				method: "POST",
				headers: asAlice,
				body: { targetId: into.id },
				idempotent: true,
			}),
			c.merge,
		);
		expect(merged).toMatchObject({ id: into.id, expenseCount: 2 });
		const budgets = await adminDb.budget.findMany({
			where: { userId: alice, categoryId: into.id },
			orderBy: { period: "asc" },
		});
		// October keeps the target's own budget; November moves over.
		expect(budgets.map((b) => b.amount.toString())).toEqual(["200", "60"]);
		await expect(
			adminDb.recurringTemplate.count({ where: { categoryId: into.id } }),
		).resolves.toBe(1);
		await expect(
			adminDb.category.count({ where: { id: from.id } }),
		).resolves.toBe(0);

		await expectProblem(
			await call(`/categories/${into.id}/merge`, {
				method: "POST",
				headers: asAlice,
				body: { targetId: into.id },
				idempotent: true,
			}),
			400,
			"bad_request",
		);
	});

	it("keeps users apart (RLS)", async () => {
		const mine = await expectBody<Category>(
			await create(asAlice, "Private"),
			c.create,
			201,
		);
		await expectProblem(
			await call(`/categories/${mine.id}`, { headers: asBob }),
			404,
			"not_found",
		);
		await expectProblem(
			await call(`/categories/${mine.id}`, {
				method: "PATCH",
				headers: asBob,
				body: { name: "Mine now" },
				idempotent: true,
			}),
			404,
			"not_found",
		);
		await expectProblem(
			await call(`/categories/${mine.id}`, {
				method: "DELETE",
				headers: asBob,
				idempotent: true,
			}),
			404,
			"not_found",
		);
		const bobsList = await expectBody<{ items: Category[] }>(
			await call("/categories", { headers: asBob }),
			c.list,
		);
		expect(bobsList.items.map((x) => x.id)).not.toContain(mine.id);
		await expect(
			adminDb.category.findUnique({ where: { id: mine.id } }),
		).resolves.toMatchObject({
			name: "Private",
		});
	});
});
