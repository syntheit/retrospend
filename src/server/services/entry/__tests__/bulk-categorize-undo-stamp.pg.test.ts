/**
 * Undo of a bulk categorize (finding 10): it runs only while every row it
 * moved still has the `updatedAt` the move left, compared under lock, and one
 * stale row refuses the whole undo with nothing changed. The web's save over
 * `previous` and v1's undo token share one mutation, so each case runs on both.
 *
 * ARS home, Blue 1,545 per USD (set below, not the harness's 1,468). Three
 * rows in Food: a USD 100 (counts), b USD 50 (counts), c USD 20 (already held
 * out of analytics). Moving all three into the category held out by default
 * flips the flag on a and b only: spent drops by (100 + 50) x 1,545 =
 * ARS 231,750.00, which is minor 23,175,000. c stays at zero change.
 */
import { randomUUID } from "node:crypto";
import { UNDO_NOT_VALID } from "@retrospend/domain/expense-write/refusals";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { call } from "~/server/api/v1/core/__tests__/harness";
import { seedArsRates } from "~/server/services/accounts/test-fixtures";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import {
	book,
	lunch,
	makeWorld,
	stored,
	type World,
} from "./expense-write-kit";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const STALE = "This expense changed since. Undo is no longer safe.";

let w: World;
let third: string;
beforeAll(async () => {
	await seedArsRates();
	await adminDb.exchangeRate.updateMany({
		where: { currency: "ARS", type: "blue" },
		data: { rate: "1545" },
	});
	w = await makeWorld();
	third = (
		await fixtureDb.category.create({
			data: {
				userId: w.userId,
				name: `Third ${randomUUID().slice(0, 6)}`,
				color: "teal",
				kind: "EXPENSE",
			},
		})
	).id;
});

/** a, b and c as described above, all in Food. */
async function threeRows() {
	const a = await book(w.userId, lunch(w, { amount: "100" }));
	const b = await book(w.userId, lunch(w, { amount: "50" }));
	const c = await book(
		w.userId,
		lunch(w, { amount: "20", excludeFromAnalytics: true }),
	);
	return { a, b, c, all: [a, b, c] };
}

const snapshot = async (ids: string[]) =>
	Object.fromEntries(
		await Promise.all(
			ids.map(async (id) => {
				const row = await stored(id);
				return [
					id,
					{
						categoryId: row?.categoryId,
						excluded: row?.excludeFromAnalytics,
						stamp: row?.updatedAt.toISOString(),
					},
				] as const;
			}),
		),
	);

const spentDelta = (r: {
	changes: readonly { id: string; delta: unknown }[];
}) => r.changes.find((c) => c.id === "glance.spent")?.delta;

describe("web: entry.expense.categorize", () => {
	const moveAll = (ids: string[]) => ({
		moves: [{ categoryId: w.holdByDefault, ids }],
	});
	const undoOf = (saved: {
		value: {
			previous: readonly { ids: readonly string[] }[];
			stamps: Record<string, string>;
		};
	}) =>
		({
			moves: saved.value.previous.map((m) => ({ ...m, ids: [...m.ids] })),
			lenient: true,
			expected: saved.value.stamps,
		}) as never;
	const editB = (id: string) =>
		w.callers.entry.expense.update.save({
			id,
			...lunch(w, { amount: "50", categoryId: third }),
		});

	it("answers the stamp each reached row has now", async () => {
		const rows = await threeRows();
		const saved = await w.callers.entry.expense.categorize.save(
			moveAll(rows.all),
		);
		const now = await snapshot(rows.all);
		expect(saved.value.stamps).toEqual(
			Object.fromEntries(rows.all.map((id) => [id, now[id]?.stamp])),
		);
	});

	it("an undo with no later edit puts all three back, flag included, and its preview shows the spent it returns", async () => {
		const { expense } = w.callers.entry;
		const rows = await threeRows();
		const saved = await expense.categorize.save(moveAll(rows.all));
		expect(saved.value.updated).toBe(3);
		const moved = await snapshot(rows.all);
		for (const id of rows.all)
			expect(moved[id]).toMatchObject({
				categoryId: w.holdByDefault,
				excluded: true,
			});

		const undo = undoOf(saved);
		expect(spentDelta(await expense.categorize.preview(undo))).toEqual({
			minor: 23_175_000,
			currency: "ARS",
		});
		expect(await snapshot(rows.all)).toEqual(moved);

		await expense.categorize.save(undo);
		const back = await snapshot(rows.all);
		expect(back[rows.a]).toMatchObject({ categoryId: w.food, excluded: false });
		expect(back[rows.b]).toMatchObject({ categoryId: w.food, excluded: false });
		expect(back[rows.c]).toMatchObject({ categoryId: w.food, excluded: true });
	});

	it("an edit to one moved row since refuses the whole undo, on the save and on its preview, and nothing changes", async () => {
		const { expense } = w.callers.entry;
		const rows = await threeRows();
		const saved = await expense.categorize.save(moveAll(rows.all));
		await editB(rows.b);
		const before = await snapshot(rows.all);
		expect(before[rows.b]?.categoryId).toBe(third);
		expect(before[rows.a]).toMatchObject({
			categoryId: w.holdByDefault,
			excluded: true,
		});

		const undo = undoOf(saved);
		await expect(expense.categorize.save(undo)).rejects.toMatchObject({
			code: "CONFLICT",
			message: STALE,
		});
		await expect(expense.categorize.preview(undo)).rejects.toMatchObject({
			code: "CONFLICT",
			message: STALE,
		});
		expect(await snapshot(rows.all)).toEqual(before);
	});

	it("a row the move left alone (already in the category) still guards the undo", async () => {
		const { expense } = w.callers.entry;
		const held = await book(
			w.userId,
			lunch(w, { amount: "10", categoryId: w.holdByDefault }),
		);
		const moved = await book(w.userId, lunch(w, { amount: "10" }));
		const saved = await expense.categorize.save(moveAll([held, moved]));
		expect(saved.value.updated).toBe(2);
		await w.callers.entry.expense.update.save({
			id: held,
			...lunch(w, { amount: "10", categoryId: third }),
		});
		const before = await snapshot([held, moved]);
		await expect(expense.categorize.save(undoOf(saved))).rejects.toMatchObject({
			code: "CONFLICT",
		});
		expect(await snapshot([held, moved])).toEqual(before);
	});

	it("an undo with no stamps, a missing stamp or an extra one is not valid, and nothing changes", async () => {
		const { expense } = w.callers.entry;
		const rows = await threeRows();
		const saved = await expense.categorize.save(moveAll(rows.all));
		const before = await snapshot(rows.all);
		const full = undoOf(saved) as {
			moves: unknown;
			lenient: true;
			expected: Record<string, string>;
		};
		const { [rows.c]: _dropped, ...missing } = full.expected;
		const extra = {
			...full.expected,
			[randomUUID()]: "2026-11-25T00:00:00.000Z",
		};
		for (const expected of [undefined, {}, missing, extra]) {
			const bad = { ...full, expected } as never;
			await expect(expense.categorize.save(bad)).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: UNDO_NOT_VALID,
			});
			await expect(expense.categorize.preview(bad)).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: UNDO_NOT_VALID,
			});
		}
		expect(await snapshot(rows.all)).toEqual(before);
	});

	it("a row deleted since is not a change: the others come back", async () => {
		const { expense } = w.callers.entry;
		const rows = await threeRows();
		const saved = await expense.categorize.save(moveAll(rows.all));
		await expense.delete.save({ id: rows.c });
		const done = await expense.categorize.save(undoOf(saved));
		expect(done.value.updated).toBe(2);
		expect(done.value.skipped).toEqual([{ id: rows.c, reason: "notFound" }]);
		const back = await snapshot([rows.a, rows.b]);
		expect(back[rows.a]).toMatchObject({ categoryId: w.food, excluded: false });
		expect(back[rows.b]).toMatchObject({ categoryId: w.food, excluded: false });
	});

	it("the redo of an undo is guarded the same way", async () => {
		const { expense } = w.callers.entry;
		const rows = await threeRows();
		const undone = await expense.categorize.save(
			undoOf(await expense.categorize.save(moveAll(rows.all))),
		);
		const redo = undoOf(undone);
		await editB(rows.b);
		const before = await snapshot(rows.all);
		await expect(expense.categorize.save(redo)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		expect(await snapshot(rows.all)).toEqual(before);
	});
});

describe("v1: POST /expenses/bulk-category and its undo token", () => {
	const send = (path: string, method: string, body?: unknown) =>
		call(path, {
			method,
			headers: w.http,
			...(body === undefined ? {} : { body }),
			idempotent: true,
		});
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
	const moveAll = async (ids: string[]) =>
		(await (
			await send("/expenses/bulk-category", "POST", {
				ids,
				categoryId: w.holdByDefault,
			})
		).json()) as { updated: number; undo: string };
	const editB = (id: string) =>
		send(
			`/expenses/${id}`,
			"PUT",
			lunch(w, { amount: "50", categoryId: third }),
		);
	const STALE_409 = { status: 409, code: "conflict", message: STALE };

	it("an undo with no later edit puts all three back, flag included, and the redo is guarded too", async () => {
		const rows = await threeRows();
		const done = await moveAll(rows.all);
		expect(done.updated).toBe(3);

		const back = (await (
			await send("/expenses/undo", "POST", { token: done.undo })
		).json()) as { redo: string };
		const restored = await snapshot(rows.all);
		expect(restored[rows.a]).toMatchObject({
			categoryId: w.food,
			excluded: false,
		});
		expect(restored[rows.b]).toMatchObject({
			categoryId: w.food,
			excluded: false,
		});
		expect(restored[rows.c]).toMatchObject({
			categoryId: w.food,
			excluded: true,
		});

		await editB(rows.b);
		const before = await snapshot(rows.all);
		expect(
			await problem(await send("/expenses/undo", "POST", { token: back.redo })),
		).toEqual(STALE_409);
		expect(await snapshot(rows.all)).toEqual(before);
	});

	it("an edit to one moved row since refuses the undo and its preview with a conflict, and nothing changes", async () => {
		const rows = await threeRows();
		const done = await moveAll(rows.all);
		await editB(rows.b);
		const before = await snapshot(rows.all);

		expect(
			await problem(await send("/expenses/undo", "POST", { token: done.undo })),
		).toEqual(STALE_409);
		expect(
			await problem(
				await send("/expenses/undo/preview", "POST", { token: done.undo }),
			),
		).toEqual(STALE_409);
		expect(await snapshot(rows.all)).toEqual(before);
	});
});
