/**
 * `expectedUpdatedAt` on PUT and DELETE /expenses/{id} and their preview
 * twins, on Postgres: a stale stamp is 409 `expense_changed` with the row
 * untouched, a matching one writes, no stamp behaves as before, a gone row is
 * still 404, and an undo keeps its own stale answer (`conflict`).
 */

import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { dayKey } from "@retrospend/domain/time-zone";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { defaultTimeZone } from "~/server/services/user-time-zone";
import {
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
type Write = { expense: { id: string; updatedAt: string }; undo: string };
type Preview = { changes: { id: string; delta: { minor: number } }[] };

const today = () => dayKey(new Date(), defaultTimeZone());

describe("expectedUpdatedAt on /api/v1/expenses writes", () => {
	let as: Record<string, string>;
	let food: string;

	beforeAll(async () => {
		const userId = (await createTestUser()).user.id;
		as = await asMobile(userId);
		food = (
			await fixtureDb.category.create({
				data: {
					userId,
					name: `Food ${randomUUID().slice(0, 6)}`,
					color: "teal",
				},
			})
		).id;
	});

	const fields = (title: string, amount: string) => ({
		title,
		amount,
		currency: "USD",
		date: today(),
		categoryId: food,
	});

	const add = async (title = "Lunch", amount = "10") =>
		expectBody<Write>(
			await call("/expenses", {
				method: "POST",
				headers: as,
				body: fields(title, amount),
				idempotent: true,
			}),
			c.create,
			201,
		);

	const put = (id: string, body: unknown) =>
		call(`/expenses/${id}`, {
			method: "PUT",
			headers: as,
			body,
			idempotent: true,
		});

	const putPreview = (id: string, body: unknown) =>
		call(`/expenses/${id}/preview`, {
			method: "POST",
			headers: as,
			body,
			idempotent: true,
		});

	const del = (id: string, stamp?: string) =>
		call(
			`/expenses/${id}${stamp ? `?expectedUpdatedAt=${encodeURIComponent(stamp)}` : ""}`,
			{ method: "DELETE", headers: as, idempotent: true },
		);

	const delPreview = (id: string, body: unknown = {}) =>
		call(`/expenses/${id}/delete/preview`, {
			method: "POST",
			headers: as,
			body,
			idempotent: true,
		});

	/** Another device edits the row, so the first reader's stamp goes stale. */
	async function editElsewhere(id: string) {
		const done = await expectBody<Write>(
			await put(id, fields("Edited elsewhere", "11")),
			c.update,
		);
		return done.expense.updatedAt;
	}

	const row = (id: string) =>
		fixtureDb.expense.findUniqueOrThrow({ where: { id } });

	it("PUT with a stale stamp is 409 expense_changed and the row is unchanged", async () => {
		const made = await add();
		const id = made.expense.id;
		const newer = await editElsewhere(id);
		const before = await row(id);

		await expectProblem(
			await put(id, {
				...fields("Mine", "99"),
				expectedUpdatedAt: made.expense.updatedAt,
			}),
			409,
			"expense_changed",
		);
		const after = await row(id);
		expect(after.title).toBe("Edited elsewhere");
		expect(after.amount.toString()).toBe("11");
		expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
		expect(after.updatedAt.toISOString()).toBe(newer);
	});

	it("PUT with the current stamp writes, also spelled with an offset", async () => {
		const made = await add();
		const id = made.expense.id;
		const done = await expectBody<Write>(
			await put(id, {
				...fields("Stamped", "20"),
				expectedUpdatedAt: made.expense.updatedAt,
			}),
			c.update,
		);
		expect(done.expense.updatedAt).not.toBe(made.expense.updatedAt);
		expect((await row(id)).title).toBe("Stamped");

		const offset = done.expense.updatedAt.replace("Z", "+00:00");
		await expectBody(
			await put(id, { ...fields("Offset", "21"), expectedUpdatedAt: offset }),
			c.update,
		);
		expect((await row(id)).title).toBe("Offset");
	});

	it("PUT without a stamp writes over a newer row, as before", async () => {
		const made = await add();
		await editElsewhere(made.expense.id);
		await expectBody(
			await put(made.expense.id, fields("Last writer", "30")),
			c.update,
		);
		expect((await row(made.expense.id)).title).toBe("Last writer");
	});

	it("previewUpdate refuses a stale stamp the same way and writes nothing", async () => {
		const made = await add();
		const id = made.expense.id;
		await editElsewhere(id);
		const stale = {
			...fields("Mine", "99"),
			expectedUpdatedAt: made.expense.updatedAt,
		};
		await expectProblem(await putPreview(id, stale), 409, "expense_changed");
		expect((await row(id)).title).toBe("Edited elsewhere");
	});

	it("previewUpdate with the current stamp answers what the write does", async () => {
		const made = await add("Before", "10");
		const id = made.expense.id;
		const next = {
			...fields("After", "25"),
			expectedUpdatedAt: made.expense.updatedAt,
		};
		const preview = await expectBody<Preview>(
			await putPreview(id, next),
			c.previewUpdate,
		);
		expect(preview.changes.find((x) => x.id === "spent")?.delta.minor).toBe(
			1500,
		);
		expect((await row(id)).title).toBe("Before");
		await expectBody(await put(id, next), c.update);
		expect((await row(id)).amount.toString()).toBe("25");
	});

	it("PUT and its preview of a gone row stay 404 with a stamp", async () => {
		const made = await add();
		const id = made.expense.id;
		await fixtureDb.expense.delete({ where: { id } });
		const body = {
			...fields("Mine", "5"),
			expectedUpdatedAt: made.expense.updatedAt,
		};
		await expectProblem(await put(id, body), 404, "not_found");
		await expectProblem(await putPreview(id, body), 404, "not_found");
	});

	it("DELETE with a stale stamp is 409 expense_changed and the row stays", async () => {
		const made = await add();
		const id = made.expense.id;
		await editElsewhere(id);
		await expectProblem(
			await del(id, made.expense.updatedAt),
			409,
			"expense_changed",
		);
		await expect(fixtureDb.expense.count({ where: { id } })).resolves.toBe(1);
	});

	it("DELETE with the current stamp deletes; without a stamp it deletes too", async () => {
		const first = await add();
		await expectBody(
			await del(first.expense.id, first.expense.updatedAt),
			c.delete,
		);
		await expect(
			fixtureDb.expense.count({ where: { id: first.expense.id } }),
		).resolves.toBe(0);

		const second = await add();
		await editElsewhere(second.expense.id);
		await expectBody(await del(second.expense.id), c.delete);
		await expect(
			fixtureDb.expense.count({ where: { id: second.expense.id } }),
		).resolves.toBe(0);
	});

	it("previewDelete checks the stamp in its body the same way", async () => {
		const made = await add();
		const id = made.expense.id;
		const preview = await expectBody<Preview>(
			await delPreview(id, { expectedUpdatedAt: made.expense.updatedAt }),
			c.previewDelete,
		);
		expect(preview.changes.find((x) => x.id === "spent")?.delta.minor).toBe(
			-1000,
		);
		await editElsewhere(id);
		await expectProblem(
			await delPreview(id, { expectedUpdatedAt: made.expense.updatedAt }),
			409,
			"expense_changed",
		);
		await expect(fixtureDb.expense.count({ where: { id } })).resolves.toBe(1);
	});

	it("DELETE and its preview of a gone row stay 404 with a stamp", async () => {
		const made = await add();
		const id = made.expense.id;
		await fixtureDb.expense.delete({ where: { id } });
		await expectProblem(
			await del(id, made.expense.updatedAt),
			404,
			"not_found",
		);
		await expectProblem(
			await delPreview(id, { expectedUpdatedAt: made.expense.updatedAt }),
			404,
			"not_found",
		);
	});

	it("a stamped write's undo works, and a stale undo is still `conflict`", async () => {
		const made = await add("Before", "10");
		const id = made.expense.id;
		const done = await expectBody<Write>(
			await put(id, {
				...fields("After", "12"),
				expectedUpdatedAt: made.expense.updatedAt,
			}),
			c.update,
		);
		await editElsewhere(id);
		await expectProblem(
			await call("/expenses/undo", {
				method: "POST",
				headers: as,
				body: { token: done.undo },
				idempotent: true,
			}),
			409,
			"conflict",
		);

		const again = await add("Again", "10");
		const stamped = await expectBody<Write>(
			await put(again.expense.id, {
				...fields("Changed", "12"),
				expectedUpdatedAt: again.expense.updatedAt,
			}),
			c.update,
		);
		await expectBody(
			await call("/expenses/undo", {
				method: "POST",
				headers: as,
				body: { token: stamped.undo },
				idempotent: true,
			}),
			c.undo,
		);
		expect((await row(again.expense.id)).title).toBe("Again");
	});
});
