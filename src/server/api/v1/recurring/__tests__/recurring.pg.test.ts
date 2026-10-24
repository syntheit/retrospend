/**
 * /api/v1/recurring on Postgres: templates in and out, paging, the summary,
 * Confirm with a preview, a varying amount, recurring income, undo,
 * idempotent replay and cross-user 404.
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

const c = contract.recurring;
type Money = { minor: number; currency: string };
type Item = {
	id: string;
	title: string;
	amount: Money;
	state: string;
	direction: string;
	amountMode: string;
	paused: boolean;
	dueAt: string;
	websiteUrl: string | null;
};
type Confirm = {
	confirmed: {
		expenseId: string;
		templateId: string;
		direction: string;
		nextDueAt: string | null;
	};
	undo: string;
};
type Preview = { changes: { id: string; delta: Money }[] };

const daysAgo = (n: number) =>
	new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe("/api/v1/recurring", () => {
	useApiV1();
	let userId: string;
	let otherId: string;
	let as: Record<string, string>;
	let asOther: Record<string, string>;

	beforeAll(async () => {
		userId = (await createTestUser()).user.id;
		otherId = (await createTestUser()).user.id;
		as = await asMobile(userId);
		asOther = await asMobile(otherId);
	});

	const send = (
		method: string,
		path: string,
		body?: unknown,
		headers = as,
		key?: string,
	) => call(path, { method, headers, body, idempotent: key ?? true });
	const make = async (extra: Record<string, unknown> = {}, headers = as) =>
		expectBody<Item>(
			await send(
				"POST",
				"/recurring",
				{
					name: "Netflix",
					amount: "15",
					currency: "USD",
					frequency: "MONTHLY",
					nextDueDate: daysAgo(3),
					...extra,
				},
				headers,
			),
			c.create,
			201,
		);

	it("creates a template and reads it back as an item", async () => {
		const item = await make({
			websiteUrl: "https://netflix.example/billing",
			paymentSource: "Visa",
		});
		expect(item).toMatchObject({
			title: "Netflix",
			amount: { minor: 1500, currency: "USD" },
			state: "overdue",
			direction: "out",
			amountMode: "fixed",
			paused: false,
			websiteUrl: "https://netflix.example/billing",
		});
		const got = await expectBody<Item>(
			await call(`/recurring/${item.id}`, { headers: as }),
			c.get,
		);
		expect(got.id).toBe(item.id);
	});

	it("pages templates by next due date with an opaque cursor", async () => {
		const user = (await createTestUser()).user.id;
		const paged = await asMobile(user);
		for (const [name, ago] of [
			["Third", 1],
			["First", 9],
			["Second", 5],
		] as const)
			await make({ name, nextDueDate: daysAgo(ago) }, paged);
		const names: string[] = [];
		let cursor: string | null = null;
		do {
			const qs: string = cursor ? `&cursor=${cursor}` : "";
			const page: { items: Item[]; nextCursor: string | null } =
				await expectBody(
					await call(`/recurring?limit=2${qs}`, { headers: paged }),
					c.list,
				);
			names.push(...page.items.map((i) => i.title));
			cursor = page.nextCursor;
		} while (cursor);
		expect(names).toEqual(["First", "Second", "Third"]);
		await expectProblem(
			await call("/recurring?cursor=nope", { headers: paged }),
			400,
			"bad_request",
		);
	});

	it("summarizes what recurring costs", async () => {
		const user = (await createTestUser()).user.id;
		const mine = await asMobile(user);
		await make({ name: "Rent", amount: "1000" }, mine);
		await make({ name: "Gym", amount: "30", frequency: "YEARLY" }, mine);
		const summary = await expectBody<{
			homeCurrency: string;
			out: { month: Money; year: Money };
			in: unknown;
		}>(await call("/recurring/summary", { headers: mine }), c.summary);
		expect(summary.homeCurrency).toBe("USD");
		// 1000 a month + 30 a year = 1002.50 a month.
		expect(summary.out.month).toEqual({ minor: 100_250, currency: "USD" });
		expect(summary.in).toBeNull();
	});

	it("changes and pauses a template, and deletes it", async () => {
		const item = await make({ name: "Old name" });
		const changed = await expectBody<Item>(
			await send("PATCH", `/recurring/${item.id}`, {
				name: "New name",
				amount: "20",
				paused: true,
				websiteUrl: null,
			}),
			c.update,
		);
		expect(changed).toMatchObject({
			title: "New name",
			amount: { minor: 2000, currency: "USD" },
			paused: true,
			websiteUrl: null,
		});
		await expectBody(await send("DELETE", `/recurring/${item.id}`), c.delete);
		await expect(
			adminDb.recurringTemplate.count({ where: { id: item.id } }),
		).resolves.toBe(0);
		await expectProblem(
			await send("DELETE", `/recurring/${item.id}`),
			404,
			"not_found",
		);
	});

	it("confirms a due template after a preview, and moves it on", async () => {
		const item = await make({ name: "Confirm me" });
		const preview = await expectBody<Preview>(
			await send("POST", `/recurring/${item.id}/confirm/preview`, {
				dueAt: item.dueAt,
			}),
			c.previewConfirm,
		);
		expect(preview.changes.find((x) => x.id === "spent")?.delta).toEqual({
			minor: 1500,
			currency: "USD",
		});
		await expect(
			adminDb.expense.count({ where: { recurringTemplateId: item.id } }),
		).resolves.toBe(0);

		const done = await expectBody<Confirm>(
			await send("POST", `/recurring/${item.id}/confirm`, {
				dueAt: item.dueAt,
			}),
			c.confirm,
		);
		expect(done.confirmed).toMatchObject({
			templateId: item.id,
			direction: "out",
		});
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: done.confirmed.expenseId },
		});
		expect(row.amount.toString()).toBe("15");
		expect(row.recurringTemplateId).toBe(item.id);
		const moved = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id: item.id },
		});
		expect(moved.nextDueDate.getTime()).toBeGreaterThan(
			new Date(item.dueAt).getTime(),
		);

		// The same confirm again is refused, not booked for the next period.
		await expectProblem(
			await send("POST", `/recurring/${item.id}/confirm`, {
				dueAt: item.dueAt,
			}),
			409,
			"conflict",
		);
	});

	it("replays a confirm with the same key and books once", async () => {
		const item = await make({ name: "Once" });
		const key = randomUUID();
		const first = await send(
			"POST",
			`/recurring/${item.id}/confirm`,
			{},
			as,
			key,
		);
		const second = await send(
			"POST",
			`/recurring/${item.id}/confirm`,
			{},
			as,
			key,
		);
		expect(second.headers.get("idempotent-replayed")).toBe("true");
		expect(await second.json()).toEqual(await first.json());
		await expect(
			adminDb.expense.count({ where: { recurringTemplateId: item.id } }),
		).resolves.toBe(1);
	});

	it("asks for the amount when it varies, and books the amount given", async () => {
		const item = await make({ name: "Electricity", amountMode: "ask" });
		expect(item.amountMode).toBe("ask");
		await expectProblem(
			await send("POST", `/recurring/${item.id}/confirm`, {}),
			400,
			"bad_request",
		);
		const done = await expectBody<Confirm>(
			await send("POST", `/recurring/${item.id}/confirm`, { amount: "22.5" }),
			c.confirm,
		);
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: done.confirmed.expenseId },
		});
		expect(row.amount.toString()).toBe("22.5");
	});

	it("refuses income-only options on an expense template", async () => {
		const item = await make({ name: "Plain" });
		await expectProblem(
			await send("POST", `/recurring/${item.id}/confirm`, { usePlan: true }),
			400,
			"bad_request",
		);
	});

	it("undoes a confirm: the entry goes and the template is due again", async () => {
		const item = await make({ name: "Undo me" });
		const done = await expectBody<Confirm>(
			await send("POST", `/recurring/${item.id}/confirm`, {}),
			c.confirm,
		);
		const preview = await expectBody<Preview>(
			await send("POST", "/recurring/undo/preview", { token: done.undo }),
			c.previewUndo,
		);
		expect(preview.changes.find((x) => x.id === "spent")?.delta).toEqual({
			minor: -1500,
			currency: "USD",
		});
		const undone = await expectBody<{ expenseId: string; redo: unknown }>(
			await send("POST", "/recurring/undo", { token: done.undo }),
			c.undo,
		);
		expect(undone.redo).toBeNull();
		await expect(
			adminDb.expense.count({ where: { id: done.confirmed.expenseId } }),
		).resolves.toBe(0);
		const back = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id: item.id },
		});
		expect(back.nextDueDate.toISOString()).toBe(item.dueAt);
	});

	it("runs recurring income: create as `in`, confirm books money in, undo removes it", async () => {
		const item = await make({ name: "Pay", amount: "2000", direction: "in" });
		expect(item.direction).toBe("in");
		const done = await expectBody<Confirm>(
			await send("POST", `/recurring/${item.id}/confirm`, {
				dueAt: item.dueAt,
			}),
			c.confirm,
		);
		expect(done.confirmed.direction).toBe("in");
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: done.confirmed.expenseId },
		});
		expect(row).toMatchObject({ direction: "IN", inType: "INCOME" });

		await expectBody(
			await send("POST", "/recurring/undo", { token: done.undo }),
			c.undo,
		);
		await expect(
			adminDb.expense.count({ where: { id: done.confirmed.expenseId } }),
		).resolves.toBe(0);
	});

	it("keeps templates to their owner", async () => {
		const item = await make({ name: "Alice only" });
		await expectProblem(
			await call(`/recurring/${item.id}`, { headers: asOther }),
			404,
			"not_found",
		);
		await expectProblem(
			await send("PATCH", `/recurring/${item.id}`, { name: "x" }, asOther),
			404,
			"not_found",
		);
		await expectProblem(
			await send("DELETE", `/recurring/${item.id}`, undefined, asOther),
			404,
			"not_found",
		);
		await expectProblem(
			await send("POST", `/recurring/${item.id}/confirm`, {}, asOther),
			404,
			"not_found",
		);
		await expectProblem(
			await send("POST", `/recurring/${item.id}/confirm/preview`, {}, asOther),
			404,
			"not_found",
		);
		const page = await expectBody<{ items: Item[] }>(
			await call("/recurring", { headers: asOther }),
			c.list,
		);
		expect(page.items).toHaveLength(0);
		const done = await expectBody<Confirm>(
			await send("POST", `/recurring/${item.id}/confirm`, {}),
			c.confirm,
		);
		await expectProblem(
			await send("POST", "/recurring/undo", { token: done.undo }, asOther),
			400,
			"bad_request",
		);
	});

	it("needs write:money to confirm and write:expenses to edit templates", async () => {
		const item = await make({ name: "Scopes" });
		const expensesOnly = await asKey(userId, ["read", "write:expenses"]);
		await expectProblem(
			await send("POST", `/recurring/${item.id}/confirm`, {}, expensesOnly),
			403,
			"missing_scope",
		);
		await expectBody<Item>(
			await send(
				"PATCH",
				`/recurring/${item.id}`,
				{ autoPay: false },
				expensesOnly,
			),
			c.update,
		);
		const moneyOnly = await asKey(userId, ["read", "write:money"]);
		await expectProblem(
			await send(
				"PATCH",
				`/recurring/${item.id}`,
				{ autoPay: true },
				moneyOnly,
			),
			403,
			"missing_scope",
		);
	});
});
