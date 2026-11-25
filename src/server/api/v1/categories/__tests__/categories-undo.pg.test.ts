/**
 * Category delete and merge over /api/v1 on Postgres: the preview twins write
 * nothing, each write hands back an undo token, the undo route takes it back
 * once, and a refused merge answers with its own code.
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
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

const c = contract.categories;

describe("/api/v1/categories delete and merge with undo", () => {
	let me: string;
	let as: Record<string, string>;

	beforeAll(async () => {
		me = (await createTestUser()).user.id;
		as = await asMobile(me);
	});

	const cat = (name: string, kind: "EXPENSE" | "INCOME" = "EXPENSE") =>
		fixtureDb.category.create({
			data: { name, color: "teal", userId: me, kind },
		});
	const row = (categoryId: string) =>
		fixtureDb.expense.create({
			data: {
				userId: me,
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
	const post = (path: string, body: unknown) =>
		call(path, { method: "POST", headers: as, body, idempotent: true });

	it("previews a merge without writing, merges, and takes it back with the token, once", async () => {
		const from = await cat("Cafe");
		const into = await cat("Food");
		const spent = await row(from.id);

		const preview = await expectBody<{
			detail: { kind: string; mode: string; counts: Record<string, unknown> };
		}>(
			await post(`/categories/${from.id}/merge/preview`, { targetId: into.id }),
			c.previewMerge,
		);
		expect(preview.detail).toMatchObject({ kind: "category.merge", mode: "merge" });
		await expect(
			fixtureDb.category.count({ where: { id: from.id } }),
		).resolves.toBe(1);

		const merged = await expectBody<{ id: string; undo: string }>(
			await post(`/categories/${from.id}/merge`, { targetId: into.id }),
			c.merge,
		);
		expect(merged.id).toBe(into.id);
		await expect(
			fixtureDb.expense.findUniqueOrThrow({ where: { id: spent.id } }),
		).resolves.toMatchObject({ categoryId: into.id });

		await expectBody(
			await post("/categories/undo/preview", { token: merged.undo }),
			c.previewUndo,
		);
		const back = await expectBody<{ id: string; redo: string }>(
			await post("/categories/undo", { token: merged.undo }),
			c.undo,
		);
		expect(back.id).toBe(from.id);
		await expect(
			fixtureDb.expense.findUniqueOrThrow({ where: { id: spent.id } }),
		).resolves.toMatchObject({ categoryId: from.id });
		await expectProblem(
			await post("/categories/undo", { token: merged.undo }),
			409,
			"conflict",
		);

		// The redo merges again.
		await expectBody(
			await post("/categories/undo", { token: back.redo }),
			c.undo,
		);
		await expect(
			fixtureDb.category.count({ where: { id: from.id } }),
		).resolves.toBe(0);
	});

	it("deletes with an undo token and previews the delete", async () => {
		const gone = await cat("Gone");
		const spent = await row(gone.id);
		await expectProblem(
			await call(`/categories/${gone.id}/delete/preview`, {
				method: "POST",
				headers: as,
				body: {},
				idempotent: true,
			}),
			409,
			"conflict",
		);
		const preview = await expectBody<{ detail: { mode: string } }>(
			await post(`/categories/${gone.id}/delete/preview`, {
				uncategorize: true,
			}),
			c.previewDelete,
		);
		expect(preview.detail.mode).toBe("delete");
		const deleted = await expectBody<{ ok: true; undo: string }>(
			await call(`/categories/${gone.id}`, {
				method: "DELETE",
				headers: as,
				body: { uncategorize: true },
				idempotent: true,
			}),
			c.delete,
		);
		await expectBody(
			await post("/categories/undo", { token: deleted.undo }),
			c.undo,
		);
		await expect(
			fixtureDb.expense.findUniqueOrThrow({ where: { id: spent.id } }),
		).resolves.toMatchObject({ categoryId: gone.id });
	});

	it("answers an expense and an income category with category_kind_mismatch", async () => {
		const expenseCat = await cat("Misc");
		const incomeCat = await cat("Salary", "INCOME");
		await expectProblem(
			await post(`/categories/${incomeCat.id}/merge`, {
				targetId: expenseCat.id,
			}),
			409,
			"category_kind_mismatch",
		);
		await expect(
			adminDb.category.count({ where: { id: incomeCat.id } }),
		).resolves.toBe(1);
	});
});
