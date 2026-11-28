/**
 * Category create and edit over /api/v1 and tRPC (M3 PR1b): the client id, the
 * version guard, the preview twins, the undo tokens and the flag. One category
 * mutation sits behind both transports. ARS home, so the expense that proves a
 * default is booked in pesos.
 *
 * Hand-derived: a new category is version 0. A rename bumps the version once
 * (the service's SQL increment), and the trigger does not double it when a color
 * changes in the same write, so rename + color + icon + flag is one step. The
 * undo of an edit is a write: it bumps once more.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { categoriesRouter } from "~/server/api/routers/categories";
import { createCallerFactory } from "~/server/api/trpc";
import {
	isoDay,
	seedArsRates,
	TODAY,
	TODAY_ZONE,
} from "~/server/services/accounts/test-fixtures";
import { makeSession } from "~/test/trpc-test-utils";
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
type TestUser = Awaited<ReturnType<typeof createTestUser>>;
type Written = {
	id: string;
	name: string;
	color: string;
	icon: string | null;
	kind: string;
	excludeByDefault: boolean;
	version: number;
	undo: string;
};
type Preview = {
	changes: unknown[];
	detail: { kind: string; id: string; version: number };
};

const rowOf = (id: string) =>
	fixtureDb.category.findUniqueOrThrow({ where: { id } });
const count = (id: string) => fixtureDb.category.count({ where: { id } });

describe("category writes over /api/v1", () => {
	let who: TestUser;
	let as: Record<string, string>;

	const send = (method: string, path: string, body?: unknown) =>
		call(path, { method, headers: as, body, idempotent: true });
	const post = (body: unknown) => send("POST", "/categories", body);
	const patch = (id: string, body: unknown) =>
		send("PATCH", `/categories/${id}`, body);
	const make = async (over: Record<string, unknown> = {}) =>
		expectBody<Written>(
			await post({
				name: `Cat ${randomUUID().slice(0, 8)}`,
				color: "teal",
				...over,
			}),
			c.create,
			201,
		);

	beforeAll(async () => {
		who = await createTestUser();
		await adminDb.user.update({
			where: { id: who.user.id },
			data: { homeCurrency: "ARS", timeZone: TODAY_ZONE },
		});
		await seedArsRates();
		as = await asMobile(who.user.id);
	});

	describe("create", () => {
		it("the preview is the write: nothing is stored, and the real create answers the same id and version", async () => {
			const id = randomUUID();
			const input = { id, name: "Previewed", color: "teal", icon: "bolt" };
			const preview = await expectBody<Preview>(
				await send("POST", "/categories/preview", input),
				c.previewCreate,
			);
			expect(preview.changes).toEqual([]);
			expect(preview.detail).toEqual({
				kind: "category.create",
				id,
				version: 0,
			});
			await expect(count(id)).resolves.toBe(0);

			const made = await expectBody<Written>(await post(input), c.create, 201);
			expect(made).toMatchObject({
				id,
				name: "Previewed",
				icon: "bolt",
				kind: "expense",
				version: preview.detail.version,
			});
			expect(await rowOf(id)).toMatchObject({ version: 0, kind: "EXPENSE" });
		});

		it("a taken id is 409 id_taken, for one of the caller's own rows and for another person's, and writes nothing", async () => {
			const mine = await make({ id: randomUUID(), name: "Mine" });
			// An own row under that id, a different name: the id answers, not the name.
			await expectProblem(
				await post({ id: mine.id, name: "Another name", color: "red" }),
				409,
				"id_taken",
			);
			// A retry of the same write (same id, same name) reads as taken too, not as a name conflict.
			await expectProblem(
				await post({ id: mine.id, name: "Mine", color: "teal" }),
				409,
				"id_taken",
			);
			expect(await rowOf(mine.id)).toMatchObject({
				name: "Mine",
				color: "teal",
			});

			const other = await createTestUser();
			const theirs = await fixtureDb.category.create({
				data: {
					id: randomUUID(),
					name: "Theirs",
					color: "blue",
					userId: other.user.id,
				},
			});
			await expectProblem(
				await post({ id: theirs.id, name: "Free name", color: "red" }),
				409,
				"id_taken",
			);
			expect(await rowOf(theirs.id)).toMatchObject({
				name: "Theirs",
				userId: other.user.id,
			});
			await expect(
				fixtureDb.category.count({
					where: { userId: who.user.id, name: "Free name" },
				}),
			).resolves.toBe(0);
		});

		it("a name already in use is a conflict whatever the id, and a case difference is another name", async () => {
			const first = await make({ name: "Food" });
			await expectProblem(
				await post({ id: randomUUID(), name: "Food ", color: "teal" }),
				409,
				"conflict",
			);
			const lower = await make({ name: "food" });
			expect(lower.id).not.toBe(first.id);
		});

		it("answers version 0 and an undo token that deletes the empty category", async () => {
			const made = await make();
			expect(made.version).toBe(0);
			const gone = await expectBody<{ id: string }>(
				await send("POST", "/categories/undo", { token: made.undo }),
				c.undo,
			);
			expect(gone.id).toBe(made.id);
			await expect(count(made.id)).resolves.toBe(0);
		});

		it("takes a kind, and a category made with excludeByDefault true files a new expense as excluded", async () => {
			const income = await make({ kind: "income" });
			expect(income.kind).toBe("income");
			const quiet = await make({ excludeByDefault: true });
			const filed = await expectBody<{ expense: { id: string } }>(
				await send("POST", "/expenses", {
					title: "Gift",
					amount: "1250.00",
					currency: "ARS",
					date: isoDay(TODAY),
					categoryId: quiet.id,
				}),
				contract.expenses.create,
				201,
			);
			await expect(
				fixtureDb.expense.findUniqueOrThrow({
					where: { id: filed.expense.id },
				}),
			).resolves.toMatchObject({ excludeFromAnalytics: true });
			// The flag defaults a new row only: the same category, flag off, does not move it.
			await expectBody(
				await patch(quiet.id, { excludeByDefault: false }),
				c.update,
			);
			await expect(
				fixtureDb.expense.findUniqueOrThrow({
					where: { id: filed.expense.id },
				}),
			).resolves.toMatchObject({ excludeFromAnalytics: true });
		});
	});

	describe("update", () => {
		it("refuses kind, and an empty body, with a validation error and writes nothing", async () => {
			const made = await make();
			const before = await rowOf(made.id);
			for (const body of [
				{ kind: "income" },
				{ name: "X", kind: "expense" },
				{},
			]) {
				const res = await patch(made.id, body);
				await expectProblem(res, 400, "validation_failed");
			}
			expect(await rowOf(made.id)).toEqual(before);
		});

		it("a stale expectedVersion is 409 category_changed and nothing changes, for the write and its preview", async () => {
			const made = await make({ name: "Guarded" });
			await expectBody(await patch(made.id, { color: "red" }), c.update);
			const before = await rowOf(made.id);
			expect(before.version).toBe(1);
			const body = { name: "Renamed", expectedVersion: 0 };
			await expectProblem(await patch(made.id, body), 409, "category_changed");
			await expectProblem(
				await send("POST", `/categories/${made.id}/preview`, body),
				409,
				"category_changed",
			);
			expect(await rowOf(made.id)).toEqual(before);
		});

		it("a stale version wins over a name that is taken: the device re-reads before it renames", async () => {
			const made = await make({ name: "Old" });
			await make({ name: "Taken" });
			await expectBody(await patch(made.id, { color: "red" }), c.update);
			await expectProblem(
				await patch(made.id, { name: "Taken", expectedVersion: 0 }),
				409,
				"category_changed",
			);
		});

		it("the current version writes, answers the next, and a preview answers the same detail", async () => {
			const made = await make({ name: "Before", icon: "house" });
			const body = {
				name: "After",
				color: "red",
				icon: null,
				excludeByDefault: true,
				expectedVersion: 0,
			};
			const preview = await expectBody<Preview>(
				await send("POST", `/categories/${made.id}/preview`, body),
				c.previewUpdate,
			);
			expect(await rowOf(made.id)).toMatchObject({
				name: "Before",
				version: 0,
			});
			const done = await expectBody<Written>(
				await patch(made.id, body),
				c.update,
			);
			// Rename + color + icon + flag in one write is one step.
			expect(done).toMatchObject({
				name: "After",
				color: "red",
				icon: null,
				excludeByDefault: true,
				version: 1,
			});
			expect(preview.detail).toEqual({
				kind: "category.update",
				id: made.id,
				version: 1,
			});
			expect(await rowOf(made.id)).toMatchObject({ version: 1 });
		});

		it("another person's category is not found, with or without a version", async () => {
			const made = await make();
			const other = await createTestUser();
			await expectProblem(
				await call(`/categories/${made.id}`, {
					method: "PATCH",
					headers: await asMobile(other.user.id),
					body: { name: "Stolen", expectedVersion: 0 },
					idempotent: true,
				}),
				404,
				"not_found",
			);
		});
	});

	describe("undo of an edit", () => {
		const undo = (token: string) => send("POST", "/categories/undo", { token });

		it("puts every replaced field back, the sealed name too, as a write: the version moves again, and the redo applies the edit once more", async () => {
			const made = await make({ name: "Original", icon: "house" });
			const done = await expectBody<Written>(
				await patch(made.id, {
					name: "Replacement",
					color: "red",
					icon: null,
					excludeByDefault: true,
					expectedVersion: 0,
				}),
				c.update,
			);
			// The previous name never rides in the readable token.
			const payload = Buffer.from(
				done.undo.split(".")[0] ?? "",
				"base64url",
			).toString();
			expect(payload).not.toContain("Original");
			expect(payload).not.toContain("Replacement");

			const preview = await expectBody(
				await send("POST", "/categories/undo/preview", { token: done.undo }),
				c.previewUndo,
			);
			expect(preview).toBeTruthy();
			expect(await rowOf(made.id)).toMatchObject({ name: "Replacement" });

			const back = await expectBody<{ id: string; redo: string }>(
				await undo(done.undo),
				c.undo,
			);
			expect(back.id).toBe(made.id);
			expect(await rowOf(made.id)).toMatchObject({
				name: "Original",
				color: "teal",
				icon: "house",
				excludeByDefault: false,
				version: 2,
			});

			const again = await expectBody<{ id: string; redo: string }>(
				await undo(back.redo),
				c.undo,
			);
			expect(again.id).toBe(made.id);
			expect(await rowOf(made.id)).toMatchObject({
				name: "Replacement",
				color: "red",
				icon: null,
				excludeByDefault: true,
				version: 3,
			});
		});

		it("only names the fields the edit named: a color edit's undo leaves the name and its version alone", async () => {
			const made = await make({ name: "Stays" });
			const done = await expectBody<Written>(
				await patch(made.id, { color: "red" }),
				c.update,
			);
			await expectBody(await undo(done.undo), c.undo);
			expect(await rowOf(made.id)).toMatchObject({
				name: "Stays",
				color: "teal",
				version: 2,
			});
		});

		it("after another write the category has another version: 409 category_changed, nothing changes, and the token is not spent", async () => {
			const made = await make({ name: "Raced" });
			const done = await expectBody<Written>(
				await patch(made.id, { color: "red" }),
				c.update,
			);
			// Another device changes the icon after our edit.
			await expectBody(await patch(made.id, { icon: "house" }), c.update);
			const before = await rowOf(made.id);
			await expectProblem(await undo(done.undo), 409, "category_changed");
			expect(await rowOf(made.id)).toEqual(before);
		});

		it("an undo of a rename after another device's rename is refused", async () => {
			const made = await make({ name: "First" });
			const done = await expectBody<Written>(
				await patch(made.id, { name: "Second" }),
				c.update,
			);
			await expectBody(await patch(made.id, { name: "Third" }), c.update);
			await expectProblem(await undo(done.undo), 409, "category_changed");
			expect(await rowOf(made.id)).toMatchObject({ name: "Third" });
		});
	});

	describe("undo of a create", () => {
		it("is refused, with nothing moved, once an expense is filed under the category", async () => {
			const made = await make({ name: "Used" });
			await fixtureDb.expense.create({
				data: {
					userId: who.user.id,
					title: "Lunch",
					amount: "1000",
					currency: "ARS",
					date: new Date(),
					categoryId: made.id,
					amountInUSD: "0.65",
					exchangeRate: "1",
					pricingSource: "MANUAL",
				},
			});
			await expectProblem(
				await send("POST", "/categories/undo", { token: made.undo }),
				409,
				"conflict",
			);
			await expect(count(made.id)).resolves.toBe(1);
		});

		it("its redo makes the category again under its id", async () => {
			const made = await make({ name: "Round trip" });
			const gone = await expectBody<{ id: string; redo: string }>(
				await send("POST", "/categories/undo", { token: made.undo }),
				c.undo,
			);
			await expectBody(
				await send("POST", "/categories/undo", { token: gone.redo }),
				c.undo,
			);
			expect(await rowOf(made.id)).toMatchObject({
				name: "Round trip",
				version: 0,
			});
		});
	});
});

describe("category writes over tRPC", () => {
	it("create and update run the same mutation: the web names no id or version, appends the events, and a no-change save leaves the version", async () => {
		const who = await createTestUser();
		const trpc = createCallerFactory(categoriesRouter)({
			session: makeSession({ id: who.user.id }),
			db: who.db,
			headers: new Headers(),
		});
		const made = await trpc.create({ name: "Web", color: "teal" });
		expect(made.version).toBe(0);
		const changed = await trpc.update({ id: made.id, color: "red" });
		expect(changed).toMatchObject({ color: "red", version: 1 });
		// Nothing named: nothing written.
		const same = await trpc.update({ id: made.id });
		expect(same.version).toBe(1);
		const events = await adminDb.apiEvent.findMany({
			where: { userId: who.user.id },
			orderBy: { seq: "asc" },
			select: { type: true, entityId: true },
		});
		expect(events).toEqual([
			{ type: "category.created", entityId: made.id },
			{ type: "category.updated", entityId: made.id },
		]);
		await expect(
			trpc.update({ id: "cnobody0000000000000000", name: "Nobody" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
