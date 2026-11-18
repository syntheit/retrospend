/**
 * Characterization of today's bulk expense writes and their undo (slice-
 * device-writes PR0): bulk categorize on the legacy tRPC router and v1 (web
 * tRPC `entry.*` has none), bulk delete and the undo tokens on v1. Pins the
 * status or code, the message, the counts and the stored rows. ARS home, USD
 * 100 at Blue 1,468 books ARS 146,800.
 */
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { call } from "~/server/api/v1/core/__tests__/harness";
import { seedArsRates } from "~/server/services/accounts/test-fixtures";
import {
	book,
	CATEGORY_NOT_FOUND,
	feeRow,
	incomeRow,
	lunch,
	makeWorld,
	rowIn,
	spreadRow,
	stored,
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

/** What a bulk answer reads as: ok with its count, or the refusal. */
type Bulk =
	| { ok: true; updated: number }
	| { ok: false; code: string; message: unknown; status?: number };

const v1Bulk = async (
	path: string,
	body: unknown,
): Promise<Bulk & { json?: unknown }> => {
	const res = await call(path, {
		method: "POST",
		headers: w.http,
		body,
		idempotent: true,
	});
	const json = (await res.json()) as Record<string, unknown>;
	if (res.ok) return { ok: true, updated: Number(json.updated), json };
	return {
		ok: false,
		status: res.status,
		code: String(json.code),
		message: json.detail ?? json.title,
	};
};

const legacyBulk = async (ids: string[], categoryId: string): Promise<Bulk> => {
	try {
		const out = await w.callers.legacy.bulkUpdateCategory({
			expenseIds: ids,
			categoryId,
		});
		return { ok: true, updated: out.count };
	} catch (error) {
		if (error instanceof TRPCError)
			return { ok: false, code: error.code, message: error.message };
		throw error;
	}
};

const categoryOf = async (id: string) => (await stored(id))?.categoryId;

describe("bulk categorize", () => {
	const refused = [
		["a category of another user", (w: World) => w.other],
		["a category that does not exist", (w: World) => w.missing],
		["an income category", (w: World) => w.income],
	] as const;

	it.each(refused)(
		"%s: v1 403 forbidden, legacy FORBIDDEN, rows unchanged",
		async (_name, pick) => {
			const mine = await book(w.userId, lunch(w));
			const before = await stored(mine);
			for (const path of [
				"/expenses/bulk-category",
				"/expenses/bulk-category/preview",
			]) {
				expect(
					await v1Bulk(path, { ids: [mine], categoryId: pick(w) }),
					path,
				).toMatchObject({
					ok: false,
					status: 403,
					code: "forbidden",
					message: CATEGORY_NOT_FOUND,
				});
			}
			expect(await legacyBulk([mine], pick(w))).toEqual({
				ok: false,
				code: "FORBIDDEN",
				message: CATEGORY_NOT_FOUND,
			});
			expect(await stored(mine)).toEqual(before);
		},
	);

	it("a bad category with ids that are not yours is still the category refusal", async () => {
		const theirs = await book(w.otherId, lunch(w, { categoryId: w.other }));
		expect(
			await v1Bulk("/expenses/bulk-category", {
				ids: [theirs, randomUUID()],
				categoryId: w.income,
			}),
		).toMatchObject({ status: 403, code: "forbidden" });
		expect(await legacyBulk([theirs], w.income)).toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("moves only your own rows, counts them, and leaves the rest and excludeFromAnalytics alone", async () => {
		const target = w.holdByDefault;
		for (const via of ["v1", "legacy"] as const) {
			const a = await book(w.userId, lunch(w, { title: "A" }));
			const b = await book(w.userId, lunch(w, { title: "B" }));
			const theirs = await book(w.otherId, lunch(w, { categoryId: w.other }));
			const ids = [a, theirs, b, randomUUID()];
			const out =
				via === "v1"
					? await v1Bulk("/expenses/bulk-category", { ids, categoryId: target })
					: await legacyBulk(ids, target);
			expect(out, via).toMatchObject({ ok: true, updated: 2 });
			expect(await categoryOf(a)).toBe(target);
			expect(await categoryOf(b)).toBe(target);
			expect(await categoryOf(theirs)).toBe(w.other);
			// The category's exclude default applies to new and edited rows, not here.
			expect((await stored(a))?.excludeFromAnalytics).toBe(false);
		}
	});

	it("only ids that are not yours: ok, nothing moved, zero updated", async () => {
		const theirs = await book(w.otherId, lunch(w, { categoryId: w.other }));
		const before = await stored(theirs);
		expect(
			await v1Bulk("/expenses/bulk-category", {
				ids: [theirs],
				categoryId: w.food,
			}),
		).toMatchObject({ ok: true, updated: 0 });
		expect(await legacyBulk([theirs], w.food)).toEqual({
			ok: true,
			updated: 0,
		});
		expect(await stored(theirs)).toEqual(before);
	});

	it("takes income rows, transfer fees and spread parents and parts as any other row", async () => {
		const salary = await incomeRow(w.userId);
		const feeId = await feeRow(w.userId);
		const { id: parent, parts } = await spreadRow(w);
		const ids = [salary, feeId, parent, parts[0] ?? ""];
		expect(
			await v1Bulk("/expenses/bulk-category", {
				ids,
				categoryId: w.holdByDefault,
			}),
		).toMatchObject({ ok: true, updated: 4 });
		for (const id of ids)
			expect(await categoryOf(id), id).toBe(w.holdByDefault);
		expect(await legacyBulk(ids, w.food)).toEqual({ ok: true, updated: 4 });
		for (const id of ids) expect(await categoryOf(id), id).toBe(w.food);
	});
});

describe("bulk delete (v1)", () => {
	const del = (ids: string[], path = "/expenses/bulk-delete") =>
		v1Bulk(path, { ids });

	it("deletes plain rows and spread parents with their parts, and skips the rest in order", async () => {
		const plain = await book(w.userId, lunch(w));
		const a = await spreadRow(w);
		const b = await spreadRow(w);
		const salary = await incomeRow(w.userId);
		const feeId = await feeRow(w.userId);
		const theirs = await book(w.otherId, lunch(w, { categoryId: w.other }));
		const unknown = randomUUID();
		const part = b.parts[0] ?? "";
		const ids = [plain, part, salary, a.id, feeId, theirs, unknown, plain];
		const preview = (await del(ids, "/expenses/bulk-delete/preview")) as {
			json: { detail: unknown; changes: { id: string; delta: unknown }[] };
		};
		expect(preview.json.detail).toEqual({
			kind: "expense.deleteMany",
			deleted: 2,
			skipped: [part, salary, feeId, theirs, unknown],
		});
		// USD 100 goes, and the spread parent's first part: USD 120 over 3 is USD 40 this month.
		// Spent falls USD 140.00; at Blue 1,468 the home figure falls ARS 146,800 + 58,720 = 205,520.00.
		expect(preview.json.changes.find((c) => c.id === "spent")?.delta).toEqual({
			minor: -14_000,
			currency: "USD",
		});
		expect(
			preview.json.changes.find((c) => c.id === "glance.spent")?.delta,
		).toEqual({ minor: -20_552_000, currency: "ARS" });
		expect(await stored(plain)).not.toBeNull();

		const done = (await del(ids)) as {
			json: { deleted: number; skipped: string[] };
		};
		expect(done.json).toMatchObject({
			deleted: 2,
			skipped: [part, salary, feeId, theirs, unknown],
		});
		for (const id of [plain, a.id, ...a.parts])
			expect(await stored(id), id).toBeNull();
		for (const id of [b.id, part, salary, feeId, theirs])
			expect(await stored(id), id).not.toBeNull();
	});

	it("refuses when nothing can go, and leaves every row", async () => {
		const salary = await incomeRow(w.userId);
		const feeId = await feeRow(w.userId);
		const theirs = await book(w.otherId, lunch(w, { categoryId: w.other }));
		for (const path of [
			"/expenses/bulk-delete",
			"/expenses/bulk-delete/preview",
		])
			expect(
				await del([salary, feeId, theirs, randomUUID()], path),
				path,
			).toMatchObject({
				ok: false,
				status: 400,
				code: "bad_request",
				message: "None of these expenses can be deleted here.",
			});
		for (const id of [salary, feeId, theirs])
			expect(await stored(id)).not.toBeNull();
	});

	it("its undo brings every row back, and the redo is refused once a row changed", async () => {
		const x = await book(w.userId, lunch(w, { title: "X" }));
		const y = await book(w.userId, lunch(w, { title: "Y" }));
		const first = (await del([x, y])) as { json: { undo: string } };
		const undone = await v1Bulk("/expenses/undo", { token: first.json.undo });
		expect(undone.ok).toBe(true);
		expect((await stored(x))?.title).toBe("X");
		const redo = (undone as { json: { redo: string } }).json.redo;

		const edited = await call(`/expenses/${x}`, {
			method: "PUT",
			headers: w.http,
			body: lunch(w, { title: "X2" }),
			idempotent: true,
		});
		expect(edited.status).toBe(200);
		expect(await v1Bulk("/expenses/undo", { token: redo })).toMatchObject({
			ok: false,
			status: 409,
			code: "conflict",
			message: "This expense changed since. Undo is no longer safe.",
		});
		expect((await stored(x))?.title).toBe("X2");
		expect(await stored(y)).not.toBeNull();
	});
});

describe("single undo (v1) and the web's revert", () => {
	const send = (path: string, method: string, body?: unknown) =>
		call(path, {
			method,
			headers: w.http,
			...(body === undefined ? {} : { body }),
			idempotent: true,
		});
	const created = async (f = lunch(w)) =>
		(await (
			await send("/expenses", "POST", { id: randomUUID(), ...f })
		).json()) as { expense: { id: string }; undo: string };
	const problem = async (res: Response) => {
		const body = (await res.json()) as {
			code: string;
			title: string;
			detail?: string;
		};
		return {
			status: res.status,
			code: body.code,
			message: body.detail ?? body.title,
		};
	};
	const STALE = {
		status: 409,
		code: "conflict",
		message: "This expense changed since. Undo is no longer safe.",
	};

	it("an update's undo is refused once a newer edit landed, and the row stays", async () => {
		const { expense } = await created();
		const first = (await (
			await send(`/expenses/${expense.id}`, "PUT", lunch(w, { title: "v2" }))
		).json()) as { undo: string };
		await send(`/expenses/${expense.id}`, "PUT", lunch(w, { title: "v3" }));
		const before = await stored(expense.id);
		expect(
			await problem(
				await send("/expenses/undo", "POST", { token: first.undo }),
			),
		).toEqual(STALE);
		expect(await stored(expense.id)).toEqual(before);
	});

	it("a create's undo is refused once the row was edited, and answers not found once it is gone", async () => {
		const edited = await created();
		await send(
			`/expenses/${edited.expense.id}`,
			"PUT",
			lunch(w, { title: "Edited" }),
		);
		expect(
			await problem(
				await send("/expenses/undo", "POST", { token: edited.undo }),
			),
		).toEqual(STALE);
		expect(await stored(edited.expense.id)).not.toBeNull();

		const deleted = await created();
		await send(`/expenses/${deleted.expense.id}`, "DELETE");
		expect(
			await problem(
				await send("/expenses/undo", "POST", { token: deleted.undo }),
			),
		).toEqual({ status: 404, code: "not_found", message: "Expense not found" });
	});

	it("the web's revert has no stamp: it writes the old values over a newer edit", async () => {
		const { entry } = w.callers;
		const id = await book(w.userId, lunch(w, { title: "Old" }));
		const form = { id, ...lunch(w, { title: "Newer" }), categoryId: w.food };
		const saved = await entry.expense.update.save(form);
		await entry.expense.update.save({ ...form, title: "Newest" });
		await entry.expense.revert.save(saved.value.restore as never);
		expect((await stored(id))?.title).toBe("Old");
	});

	// A second restore of the same token meets the row it already put back: the unique id
	// violation leaves as INTERNAL_SERVER_ERROR with Prisma's own text (a possible bug, pinned as is).
	it("the web's restore of a delete puts the row back once; a second restore is a raw database error", async () => {
		const { entry } = w.callers;
		const id = await rowIn(w.userId, w.food);
		const gone = await entry.expense.delete.save({ id });
		expect(await stored(id)).toBeNull();
		await entry.expense.restore.save({ token: gone.value.restore });
		expect(await stored(id)).not.toBeNull();
		await expect(
			entry.expense.restore.save({ token: gone.value.restore }),
		).rejects.toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: expect.stringContaining("Unique constraint failed"),
		});
	});
});
