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
	| {
			ok: false;
			code: string;
			message: unknown;
			status?: number;
			errors?: string[];
	  };

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
		...(Array.isArray(json.errors)
			? { errors: json.errors.map((e: { message: string }) => e.message) }
			: {}),
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

/** Bulk categorize through one transport (the web's `entry.*` has none). */
const categorize = (
	name: "v1" | "legacy",
	ids: string[],
	categoryId: string,
) =>
	name === "v1"
		? v1Bulk("/expenses/bulk-category", { ids, categoryId })
		: legacyBulk(ids, categoryId);

const BULK = ["v1", "legacy"] as const;
const categoryOf = async (id: string) => (await stored(id))?.categoryId;
const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
const refusedCategory = {
	v1: {
		ok: false,
		status: 403,
		code: "forbidden",
		message: CATEGORY_NOT_FOUND,
	},
	legacy: { ok: false, code: "FORBIDDEN", message: CATEGORY_NOT_FOUND },
} as const;
const tooSmall = {
	ok: false,
	status: 400,
	code: "validation_failed",
	message: "Validation failed",
	errors: ["Too small: expected array to have >=1 items"],
} as const;
const tooBig = (max: number) =>
	({
		ok: false,
		status: 400,
		code: "validation_failed",
		message: "Validation failed",
		errors: [`Too big: expected array to have <=${max} items`],
	}) as const;
/** zod's own text, printed by the router as JSON. */
const legacyIssue = (issue: object) => ({
	ok: false,
	code: "BAD_REQUEST",
	message: JSON.stringify([issue], null, 2),
});

describe("bulk categorize", () => {
	const bad = [
		["a category of another user", (w: World) => w.other],
		["a category that does not exist", (w: World) => w.missing],
		["an income category", (w: World) => w.income],
	] as const;
	const badRows = BULK.flatMap((name) =>
		bad.map(([what, pick]) => [name, what, pick] as const),
	);

	it.each(badRows)(
		"%s: %s is refused, rows unchanged",
		async (name, _what, pick) => {
			const mine = await book(w.userId, lunch(w));
			const before = await stored(mine);
			if (name === "v1") {
				// The preview twin answers the same.
				expect(
					await v1Bulk("/expenses/bulk-category/preview", {
						ids: [mine],
						categoryId: pick(w),
					}),
				).toEqual(refusedCategory.v1);
			}
			expect(await categorize(name, [mine], pick(w))).toEqual(
				refusedCategory[name],
			);
			expect(await stored(mine)).toEqual(before);
		},
	);

	it.each(BULK)(
		"%s: a bad category with ids that are not yours is still the category refusal",
		async (name) => {
			const theirs = await book(w.otherId, lunch(w, { categoryId: w.other }));
			const before = await stored(theirs);
			expect(await categorize(name, [theirs, randomUUID()], w.income)).toEqual(
				refusedCategory[name],
			);
			expect(await stored(theirs)).toEqual(before);
		},
	);

	it.each(BULK)(
		"%s: moves only your own rows, counts them, and leaves the rest and excludeFromAnalytics alone",
		async (name) => {
			const target = w.holdByDefault;
			const a = await book(w.userId, lunch(w, { title: "A" }));
			const b = await book(w.userId, lunch(w, { title: "B" }));
			const theirs = await book(w.otherId, lunch(w, { categoryId: w.other }));
			const out = await categorize(name, [a, theirs, b, randomUUID()], target);
			expect(out).toMatchObject({ ok: true, updated: 2 });
			expect(await categoryOf(a)).toBe(target);
			expect(await categoryOf(b)).toBe(target);
			expect(await categoryOf(theirs)).toBe(w.other);
			// The category's exclude default applies to new and edited rows, not here.
			expect((await stored(a))?.excludeFromAnalytics).toBe(false);
		},
	);

	it.each(BULK)(
		"%s: only ids that are not yours: ok, nothing moved, zero updated",
		async (name) => {
			const theirs = await book(w.otherId, lunch(w, { categoryId: w.other }));
			const before = await stored(theirs);
			expect(await categorize(name, [theirs], w.food)).toMatchObject({
				ok: true,
				updated: 0,
			});
			expect(await stored(theirs)).toEqual(before);
		},
	);

	it.each(BULK)(
		"%s: takes income rows, transfer fees and spread parents and parts as any other row",
		async (name) => {
			const salary = await incomeRow(w.userId);
			const feeId = await feeRow(w.userId);
			const { id: parent, parts } = await spreadRow(w);
			const all = [salary, feeId, parent, parts[0] ?? ""];
			expect(await categorize(name, all, w.holdByDefault)).toMatchObject({
				ok: true,
				updated: 4,
			});
			for (const id of all)
				expect(await categoryOf(id), id).toBe(w.holdByDefault);
		},
	);

	it("v1 preview of a categorize moves no figure and writes nothing", async () => {
		const mine = await book(w.userId, lunch(w));
		const before = await stored(mine);
		const res = await call("/expenses/bulk-category/preview", {
			method: "POST",
			headers: w.http,
			body: { ids: [mine, randomUUID()], categoryId: w.holdByDefault },
			idempotent: true,
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			changes: [],
			unchanged: [],
			unavailable: [],
		});
		expect(await stored(mine)).toEqual(before);
	});

	it("v1 write answers the count and an undo that puts the old category back", async () => {
		const mine = await book(w.userId, lunch(w));
		const done = await v1Bulk("/expenses/bulk-category", {
			ids: [mine],
			categoryId: w.holdByDefault,
		});
		expect(done).toMatchObject({ ok: true, updated: 1 });
		expect(await categoryOf(mine)).toBe(w.holdByDefault);
		const { undo } = (done as { json: { undo: string } }).json;
		expect(await v1Bulk("/expenses/undo", { token: undo })).toMatchObject({
			ok: true,
		});
		expect(await categoryOf(mine)).toBe(w.food);
	});

	const empty = {
		v1: tooSmall,
		legacy: legacyIssue({
			origin: "array",
			code: "too_small",
			minimum: 1,
			inclusive: true,
			path: ["expenseIds"],
			message: "Too small: expected array to have >=1 items",
		}),
	} as const;
	const over = {
		v1: tooBig(500),
		legacy: legacyIssue({
			origin: "array",
			code: "too_big",
			maximum: 500,
			inclusive: true,
			path: ["expenseIds"],
			message: "Too big: expected array to have <=500 items",
		}),
	} as const;
	it.each(BULK)("%s: an empty list is refused", async (name) => {
		expect(await categorize(name, [], w.food)).toEqual(empty[name]);
		if (name === "v1")
			expect(
				await v1Bulk("/expenses/bulk-category/preview", {
					ids: [],
					categoryId: w.food,
				}),
			).toEqual(empty.v1);
	});
	it.each(BULK)("%s: 501 ids are refused", async (name) => {
		expect(await categorize(name, ids(501), w.food)).toEqual(over[name]);
		if (name === "v1")
			expect(
				await v1Bulk("/expenses/bulk-category/preview", {
					ids: ids(501),
					categoryId: w.food,
				}),
			).toEqual(over.v1);
	});
	it("legacy: a category id that is not a cuid is refused before it is looked up", async () => {
		expect(await legacyBulk([randomUUID()], "nope")).toEqual(
			legacyIssue({
				origin: "string",
				code: "invalid_format",
				format: "cuid",
				pattern: "/^[cC][0-9a-z]{6,}$/",
				path: ["categoryId"],
				message: "Invalid cuid",
			}),
		);
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

	it("refuses an empty list and 101 ids, on the write and its preview", async () => {
		for (const path of [
			"/expenses/bulk-delete",
			"/expenses/bulk-delete/preview",
		]) {
			expect(await del([], path), path).toEqual(tooSmall);
			expect(await del(ids(101), path), path).toEqual(tooBig(100));
		}
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
	// violation is answered as CONFLICT, not as the database's own text.
	it("the web's restore of a delete puts the row back once; a second restore is a conflict", async () => {
		const { entry } = w.callers;
		const id = await rowIn(w.userId, w.food);
		const gone = await entry.expense.delete.save({ id });
		expect(await stored(id)).toBeNull();
		await entry.expense.restore.save({ token: gone.value.restore });
		expect(await stored(id)).not.toBeNull();
		await expect(
			entry.expense.restore.save({ token: gone.value.restore }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "That id is already used",
		});
	});
});
