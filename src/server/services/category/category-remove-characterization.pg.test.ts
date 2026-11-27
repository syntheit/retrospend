/**
 * M3 PR0: category delete and merge as they behave today, seen from the
 * edges the device slice will not move (delete and merge stay online): the
 * refusals on both transports, a merge that leaves its target alone, and the
 * undo that brings the category back, with the row fields it gets back. Also
 * what a co-participant reads of a category that is not theirs (K7).
 *
 * Hand-derived:
 *   - A refused delete or merge changes nothing: the category count and the
 *     expense rows are the same after as before.
 *   - A restore keeps the version the stash holds (M3 PR1a), and a category has
 *     no stamp, so the restored row equals the original in every column,
 *     nameIndex and version included (the same key makes the same index; the
 *     plain suite stores null both times).
 *   - A merge moves rows to the target and writes nothing to the target row.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { SERVER_KEY_PREFIX } from "@retrospend/api-contract/common";
import type { TRPCError } from "@trpc/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { problemCode } from "~/server/api/error-formatter";
import { categoriesRouter } from "~/server/api/routers/categories";
import { createCallerFactory } from "~/server/api/trpc";
import {
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	fixtureDb,
} from "~/server/api/v1/core/__tests__/harness";
import { unavailableFields } from "~/server/crypto/field-open";
import { createUserScopedDb } from "~/server/db";
import { sealedSuite } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import {
	arsUser,
	category,
	expense,
	sharedTx,
	shareOf,
} from "./__tests__/merge-kit";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const c = contract.categories;
/** A cuid-shaped id no row has: the tRPC input demands the shape. */
const missingId = () => `c${randomUUID().replaceAll("-", "")}`;
const rowOf = (id: string) =>
	fixtureDb.category.findUniqueOrThrow({ where: { id } });
const count = (where: object) => fixtureDb.category.count({ where });
/** The web's categories router as `userId`, over a client that has RLS on. */
const caller = (userId: string) =>
	createCallerFactory(categoriesRouter)({
		session: makeSession({ id: userId }),
		db: createUserScopedDb(userId),
		headers: new Headers(),
	});

describe("refusals change nothing, on tRPC and v1", () => {
	let me: string;
	let other: string;
	let api: ReturnType<typeof caller>;
	let as: Record<string, string>;
	let food: { id: string };
	let salary: { id: string };
	let theirs: { id: string };
	let held: { id: string };

	beforeAll(async () => {
		me = await arsUser();
		other = await arsUser();
		api = caller(me);
		as = await asMobile(me);
		food = await category(me, "Food");
		salary = await category(me, "Salary", { kind: "INCOME" });
		theirs = await category(other, "Theirs");
		held = await category(me, "Held");
		await expense(me, held.id, 2);
		await expense(me, held.id, 3);
	});

	const del = (id: string, body?: object) =>
		call(`/categories/${id}`, {
			method: "DELETE",
			headers: as,
			body,
			idempotent: true,
		});
	const merge = (id: string, targetId: string) =>
		call(`/categories/${id}/merge`, {
			method: "POST",
			headers: as,
			body: { targetId },
			idempotent: true,
		});

	it("an unknown or foreign category is not found", async () => {
		for (const id of [missingId(), theirs.id]) {
			await expect(api.remove({ id, targetId: null })).rejects.toMatchObject({
				code: "NOT_FOUND",
				message: "Category not found",
			});
			await expectProblem(await del(id), 404, "not_found");
			await expectProblem(await merge(id, food.id), 404, "not_found");
		}
		expect(await count({ id: theirs.id })).toBe(1);
	});

	it("a merge into itself, into an unknown or into a foreign category is a bad request", async () => {
		await expect(
			api.remove({ id: food.id, targetId: food.id }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "A category cannot be merged into itself",
		});
		await expectProblem(await merge(food.id, food.id), 400, "bad_request");
		for (const targetId of [missingId(), theirs.id]) {
			await expect(api.remove({ id: food.id, targetId })).rejects.toMatchObject(
				{
					code: "BAD_REQUEST",
					message: "Replacement category not found",
				},
			);
			await expectProblem(await merge(food.id, targetId), 400, "bad_request");
		}
		expect(await count({ id: food.id })).toBe(1);
	});

	it("an expense and an income category are refused with category_kind_mismatch", async () => {
		const refused = await api
			.remove({ id: salary.id, targetId: food.id })
			.catch((e) => e as TRPCError);
		expect(problemCode(refused as TRPCError)).toBe("category_kind_mismatch");
		await expectProblem(
			await merge(salary.id, food.id),
			409,
			"category_kind_mismatch",
		);
		expect(await count({ id: { in: [salary.id, food.id] } })).toBe(2);
	});

	it("v1 delete of a category with expenses needs uncategorize, tRPC remove uncategorizes unless refuseIfUsed says no", async () => {
		await expectProblem(await del(held.id), 409, "conflict");
		await expect(
			api.remove({ id: held.id, targetId: null, refuseIfUsed: true }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message:
				'This category has 2 expense(s). Please choose a replacement category or select "Uncategorized".',
		});
		expect(await count({ id: held.id })).toBe(1);
		// The bare tRPC remove has no such rule: it deletes and uncategorizes.
		const done = await api.remove({ id: held.id, targetId: null });
		expect(done.value).toMatchObject({ mode: "delete", targetId: null });
		expect(done.value.counts.expense).toEqual({ moved: 2, dropped: 0 });
		expect(await count({ id: held.id })).toBe(0);
		await api.restore({ stash: done.value.stash });
		expect(await count({ id: held.id })).toBe(1);
	});
});

describe("a merge leaves its target alone and its undo restores the category", () => {
	let me: string;
	let as: Record<string, string>;
	beforeAll(async () => {
		me = await arsUser();
		as = await asMobile(me);
	});

	const post = (path: string, body: unknown) =>
		call(path, { method: "POST", headers: as, body, idempotent: true });

	it("v1 merge writes nothing to the target row, and the undo brings the source back column for column", async () => {
		const source = await category(me, "Cafe ", {
			color: "amber",
			icon: "cup",
			excludeByDefault: true,
			isFixed: true,
		});
		const target = await category(me, "Food", {
			color: "teal",
			icon: "fork",
			excludeByDefault: true,
		});
		await expense(me, source.id, 10);
		await expense(me, source.id, 4, { excludeFromAnalytics: false });
		const sourceBefore = await rowOf(source.id);
		const targetBefore = await rowOf(target.id);

		const merged = await expectBody<{
			id: string;
			expenseCount: number;
			undo: string;
		}>(
			await post(`/categories/${source.id}/merge`, { targetId: target.id }),
			c.merge,
		);
		expect(merged).toMatchObject({ id: target.id, expenseCount: 2 });
		expect(await count({ id: source.id })).toBe(0);
		// Every column of the target is as it was: a merge is not an edit of it.
		expect(await rowOf(target.id)).toEqual(targetBefore);

		await expectBody(
			await post("/categories/undo", { token: merged.undo }),
			c.undo,
		);
		const back = await rowOf(source.id);
		expect(back).toEqual(sourceBefore);
		expect(back).toMatchObject({
			name: "Cafe ",
			color: "amber",
			icon: "cup",
			isFixed: true,
			excludeByDefault: true,
			kind: "EXPENSE",
		});
		// The undo does not touch the target either.
		expect(await rowOf(target.id)).toEqual(targetBefore);
	});

	it("tRPC remove keeps a v3 stash with the category's fields and version, and restore reads it once", async () => {
		const user = await createTestUser();
		const scoped = caller(user.user.id);
		const made = await category(user.user.id, "Stashed", {
			color: "rose",
			icon: "tag",
			excludeByDefault: true,
		});
		const done = await scoped.remove({ id: made.id, targetId: null });
		// Read as its owner: the body is sealed with the owner's key in the sealed suite.
		const stash = await user.db.idempotencyKey.findUniqueOrThrow({
			where: {
				userId_key: {
					userId: user.user.id,
					key: `${SERVER_KEY_PREFIX.undoStash}${done.value.stash}`,
				},
			},
		});
		const body = stash.responseBody as {
			v: number;
			category: Record<string, unknown>;
			targetId: string | null;
		};
		expect(body.v).toBe(3);
		expect(body.targetId).toBeNull();
		// The version rides in the stash, so a restore keeps it (a new category is 0).
		expect(body.category).toEqual({
			id: made.id,
			name: "Stashed",
			color: "rose",
			icon: "tag",
			isFixed: false,
			excludeByDefault: true,
			kind: "EXPENSE",
			version: 0,
		});

		await scoped.restore({ stash: done.value.stash });
		await expect(
			scoped.restore({ stash: done.value.stash }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(await rowOf(made.id)).toMatchObject({
			name: "Stashed",
			excludeByDefault: true,
		});
	});

	it("an undo is refused while the name is taken again, and nothing comes back", async () => {
		const source = await category(me, "Reused name");
		const done = await expectBody<{ ok: true; undo: string }>(
			await call(`/categories/${source.id}`, {
				method: "DELETE",
				headers: as,
				body: {},
				idempotent: true,
			}),
			c.delete,
		);
		await category(me, "Reused name ");
		await expectProblem(
			await post("/categories/undo", { token: done.undo }),
			409,
			"conflict",
		);
		expect(await count({ id: source.id })).toBe(0);
	});
});

describe("a co-participant reads a category that is not theirs (K7)", () => {
	it("the plain suite gives them the name, the sealed suite the empty fallback and the field list", async () => {
		const ana = await arsUser();
		const beto = await createTestUser();
		const cat = await category(ana, "Ana's dinners");
		const shared = await sharedTx(ana, cat.id);
		await shareOf(shared.id, beto.user.id, null);
		const read = await beto.db.category.findUnique({ where: { id: cat.id } });
		expect(read).not.toBeNull();
		if (sealedSuite) {
			// The name is sealed with Ana's key; Beto is entitled to the row but
			// cannot open it, so he gets the typed fallback, never ciphertext.
			expect(read?.name).toBe("");
			expect(unavailableFields(read as object)).toEqual(["name"]);
		} else {
			expect(read?.name).toBe("Ana's dinners");
			expect(unavailableFields(read as object)).toEqual([]);
		}
		// Another user with no share does not see the row at all.
		const stranger = await createTestUser();
		await expect(
			stranger.db.category.findUnique({ where: { id: cat.id } }),
		).resolves.toBeNull();
	});
});
