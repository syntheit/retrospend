/**
 * /api/v1/recurring on Postgres: templates in and out, paging, the summary,
 * Confirm with a preview, a varying amount, recurring income, undo,
 * idempotent replay and cross-user 404.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { nextRecurringDate } from "@retrospend/domain/recurring";
import { dayKey, parseDateOnlyIn } from "@retrospend/domain/time-zone";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { defaultTimeZone } from "~/server/services/user-time-zone";
import { bookedUser } from "../../budget/__tests__/fixtures";
import {
	adminDb,
	asKey,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
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
	paidOnFrom: string;
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
type Preview = {
	changes: { id: string; delta: Money }[];
	unchanged: { id: string }[];
	unavailable: { id: string }[];
};

const daysAgo = (n: number) =>
	new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

// Due today in the caller's zone: a confirm books the entry on its due day, so a
// day in the past would fall in the previous month on the 1st and leave this
// month's Spent unchanged.
const dueToday = () => dayKey(new Date(), defaultTimeZone());

describe("/api/v1/recurring", () => {
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

	it("keeps anchorDay 31 through a clamped first date", async () => {
		const item = await make({
			name: "Anchored",
			nextDueDate: "2027-02-28",
			anchorDay: 31,
		});
		const row = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id: item.id },
		});
		expect(row.anchorDay).toBe(31);
		const zone = defaultTimeZone();
		const mar = nextRecurringDate(
			row.nextDueDate,
			"MONTHLY",
			row.anchorDay,
			zone,
		);
		const apr = nextRecurringDate(mar, "MONTHLY", row.anchorDay, zone);
		expect([mar, apr].map((d) => dayKey(d, zone))).toEqual([
			"2027-03-31",
			"2027-04-30",
		]);
	});

	it("refuses a first date that is not on anchorDay", async () => {
		const res = await send("POST", "/recurring", {
			name: "Off anchor",
			amount: "15",
			currency: "USD",
			frequency: "MONTHLY",
			nextDueDate: "2027-02-27",
			anchorDay: 31,
		});
		expect(res.status).toBe(400);
	});

	it("without anchorDay the anchor is the day of the first date", async () => {
		const item = await make({ name: "Unanchored", nextDueDate: "2027-02-28" });
		const row = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id: item.id },
		});
		expect(row.anchorDay).toBe(28);
	});

	it("previews a new template without writing it", async () => {
		const user = (await createTestUser()).user.id;
		const mine = await asMobile(user);
		const body = {
			name: "Preview only",
			amount: "9",
			currency: "USD",
			frequency: "MONTHLY",
			nextDueDate: daysAgo(-5),
		};
		const preview = await expectBody<Preview>(
			await send("POST", "/recurring/preview", body, mine),
			c.previewCreate,
		);
		// It moves what recurring costs, in every period.
		expect(preview.changes.map((x) => [x.id, x.delta.minor])).toEqual([
			["recurring.cost.out.month", 900],
			["recurring.cost.out.quarter", 2700],
			["recurring.cost.out.year", 10800],
		]);
		await expect(
			adminDb.recurringTemplate.count({ where: { userId: user } }),
		).resolves.toBe(0);
		const made = await expectBody<Item>(
			await send("POST", "/recurring", body, mine),
			c.create,
			201,
		);
		expect(made.title).toBe("Preview only");
		await expect(
			adminDb.recurringTemplate.count({ where: { userId: user } }),
		).resolves.toBe(1);
	});

	it("creates once for one key, and the preview needs the write scope", async () => {
		const user = (await createTestUser()).user.id;
		const mine = await asMobile(user);
		const body = {
			name: "Once only",
			amount: "4",
			currency: "USD",
			frequency: "WEEKLY",
			nextDueDate: daysAgo(-2),
		};
		const key = randomUUID();
		const first = await send("POST", "/recurring", body, mine, key);
		const second = await send("POST", "/recurring", body, mine, key);
		expect(second.headers.get("idempotent-replayed")).toBe("true");
		expect(await second.json()).toEqual(await first.json());
		await expect(
			adminDb.recurringTemplate.count({ where: { userId: user } }),
		).resolves.toBe(1);
		const readOnly = await asKey(user, ["read"]);
		await expectProblem(
			await send("POST", "/recurring/preview", body, readOnly),
			403,
			"missing_scope",
		);
	});

	it("refuses another person's category on a create and its preview", async () => {
		const theirs = await adminDb.category.create({
			data: { userId: otherId, name: "Theirs", color: "teal" },
		});
		const body = {
			name: "Not mine",
			amount: "3",
			currency: "USD",
			frequency: "MONTHLY",
			nextDueDate: daysAgo(-1),
			categoryId: theirs.id,
		};
		await expectProblem(
			await send("POST", "/recurring/preview", body),
			403,
			"forbidden",
		);
		await expectProblem(
			await send("POST", "/recurring", body),
			403,
			"forbidden",
		);
		await expect(
			adminDb.recurringTemplate.count({ where: { name: "Not mine" } }),
		).resolves.toBe(0);
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

	it("previews a delete, deletes with an undo token, and the undo puts it back", async () => {
		const item = await make({
			name: "Gym",
			frequency: "WEEKLY",
			autoPay: false,
			paymentSource: "Visa",
		});
		const preview = await expectBody<Preview>(
			await send("POST", `/recurring/${item.id}/delete/preview`, {}),
			c.previewDelete,
		);
		const weekly = preview.changes.find(
			(x) => x.id === "recurring.cost.out.month",
		);
		expect(weekly?.delta.minor).toBeLessThan(0);
		await expect(
			adminDb.recurringTemplate.count({ where: { id: item.id } }),
		).resolves.toBe(1);

		const done = await expectBody<{ ok: true; undo: string }>(
			await send("DELETE", `/recurring/${item.id}`),
			c.delete,
		);
		await expect(
			adminDb.recurringTemplate.count({ where: { id: item.id } }),
		).resolves.toBe(0);

		await expectBody(
			await send("POST", "/recurring/delete/undo/preview", {
				token: done.undo,
			}),
			c.previewUndoDelete,
		);
		const back = await expectBody<Item>(
			await send("POST", "/recurring/delete/undo", { token: done.undo }),
			c.undoDelete,
		);
		expect(back).toMatchObject({
			id: item.id,
			title: "Gym",
			frequency: "weekly",
			autoPay: false,
			paymentSource: "Visa",
			dueAt: item.dueAt,
			amount: { minor: 1500, currency: "USD" },
		});
		await expectProblem(
			await send("POST", "/recurring/delete/undo", { token: done.undo }),
			409,
			"conflict",
		);
	});

	it("restores the links a delete cut, and shows the plan cost it can move", async () => {
		const booked = await bookedUser();
		const mine = await asMobile(booked.user.id);
		const item = await make(
			{ name: "Rent", amount: "300", nextDueDate: daysAgo(2) },
			mine,
		);
		const rent = booked.ids.Rent as string;
		await adminDb.envelope.update({
			where: { id: rent },
			data: { kind: "BILL", targetTemplateId: item.id },
		});
		const confirmed = await expectBody<Confirm>(
			await send("POST", `/recurring/${item.id}/confirm`, {}, mine),
			c.confirm,
		);
		const before = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id: item.id },
		});

		const preview = await expectBody<Preview>(
			await send("POST", `/recurring/${item.id}/delete/preview`, {}, mine),
			c.previewDelete,
		);
		const seen = new Set(
			[...preview.changes, ...preview.unchanged, ...preview.unavailable].map(
				(x) => x.id,
			),
		);
		expect(seen.has("budget.planCost")).toBe(true);
		expect(seen.has("recurring.cost.out.month")).toBe(true);

		const done = await expectBody<{ undo: string }>(
			await send("DELETE", `/recurring/${item.id}`, undefined, mine),
			c.delete,
		);
		await expect(
			adminDb.envelope.findUniqueOrThrow({ where: { id: rent } }),
		).resolves.toMatchObject({ targetTemplateId: null });
		await expect(
			adminDb.expense.findUniqueOrThrow({
				where: { id: confirmed.confirmed.expenseId },
			}),
		).resolves.toMatchObject({ recurringTemplateId: null });

		await expectBody(
			await send("POST", "/recurring/delete/undo", { token: done.undo }, mine),
			c.undoDelete,
		);
		const after = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id: item.id },
		});
		expect(after.createdAt).toEqual(before.createdAt);
		await expect(
			adminDb.envelope.findUniqueOrThrow({ where: { id: rent } }),
		).resolves.toMatchObject({ targetTemplateId: item.id });
		await expect(
			adminDb.expense.findUniqueOrThrow({
				where: { id: confirmed.confirmed.expenseId },
			}),
		).resolves.toMatchObject({ recurringTemplateId: item.id });
		// The confirm can still be undone from its own token.
		await expectBody(
			await send("POST", "/recurring/undo", { token: confirmed.undo }, mine),
			c.undo,
		);
	});

	it("leaves a link alone that changed while the template was gone", async () => {
		const booked = await bookedUser();
		const mine = await asMobile(booked.user.id);
		const item = await make({ name: "Power" }, mine);
		const other = await make({ name: "Water" }, mine);
		const rent = booked.ids.Rent as string;
		await adminDb.envelope.update({
			where: { id: rent },
			data: { kind: "BILL", targetTemplateId: item.id },
		});
		const done = await expectBody<{ undo: string }>(
			await send("DELETE", `/recurring/${item.id}`, undefined, mine),
			c.delete,
		);
		await adminDb.envelope.update({
			where: { id: rent },
			data: { targetTemplateId: other.id },
		});
		await expectBody(
			await send("POST", "/recurring/delete/undo", { token: done.undo }, mine),
			c.undoDelete,
		);
		await expect(
			adminDb.envelope.findUniqueOrThrow({ where: { id: rent } }),
		).resolves.toMatchObject({ targetTemplateId: other.id });
	});

	it("refuses to restore a template that was made again by hand", async () => {
		const user = (await createTestUser()).user.id;
		const mine = await asMobile(user);
		const item = await make({ name: "Streamly", amount: "8" }, mine);
		const done = await expectBody<{ undo: string }>(
			await send("DELETE", `/recurring/${item.id}`, undefined, mine),
			c.delete,
		);
		await make({ name: "streamly", amount: "8" }, mine);
		await expectProblem(
			await send("POST", "/recurring/delete/undo", { token: done.undo }, mine),
			409,
			"conflict",
		);
		await expect(
			adminDb.recurringTemplate.count({ where: { userId: user } }),
		).resolves.toBe(1);
	});

	it("keeps delete and its undo to the owner", async () => {
		const item = await make({ name: "Mine to delete" });
		await expectProblem(
			await send("POST", `/recurring/${item.id}/delete/preview`, {}, asOther),
			404,
			"not_found",
		);
		const done = await expectBody<{ undo: string }>(
			await send("DELETE", `/recurring/${item.id}`),
			c.delete,
		);
		await expectProblem(
			await send(
				"POST",
				"/recurring/delete/undo",
				{ token: done.undo },
				asOther,
			),
			400,
			"bad_request",
		);
		await expect(
			adminDb.recurringTemplate.count({ where: { id: item.id } }),
		).resolves.toBe(0);
	});

	it("confirms a due template after a preview, and moves it on", async () => {
		const item = await make({ name: "Confirm me", nextDueDate: dueToday() });
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
		const item = await make({ name: "Undo me", nextDueDate: dueToday() });
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

	describe.each([
		["expense", "out"],
		["income", "in"],
	] as const)("undoing an older %s confirm", (_name, direction) => {
		it("is refused while a later confirm stands, so no period is booked twice", async () => {
			// Weekly, three periods overdue: due 15, 8 and 1 days ago.
			const item = await make({
				name: `Weekly ${direction}`,
				frequency: "WEEKLY",
				nextDueDate: daysAgo(15),
				direction,
			});
			const confirm = async () =>
				expectBody<Confirm>(
					await send("POST", `/recurring/${item.id}/confirm`, {}),
					c.confirm,
				);
			const first = await confirm();
			const second = await confirm();
			const third = await confirm();
			const rows = () =>
				adminDb.expense.count({ where: { recurringTemplateId: item.id } });
			const dueAt = async () =>
				(
					await adminDb.recurringTemplate.findUniqueOrThrow({
						where: { id: item.id },
					})
				).nextDueDate.toISOString();
			expect(await rows()).toBe(3);
			const afterThree = await dueAt();

			for (const older of [first, second]) {
				await expectProblem(
					await send("POST", "/recurring/undo", { token: older.undo }),
					409,
					"conflict",
				);
				await expectProblem(
					await send("POST", "/recurring/undo/preview", { token: older.undo }),
					409,
					"conflict",
				);
			}
			expect(await rows()).toBe(3);
			expect(await dueAt()).toBe(afterThree);

			// Newest first works, and the template walks back one period each time.
			for (const token of [third.undo, second.undo, first.undo])
				await expectBody(
					await send("POST", "/recurring/undo", { token }),
					c.undo,
				);
			expect(await rows()).toBe(0);
			expect(await dueAt()).toBe(item.dueAt);

			// Confirming until it is not due books each period once: three rows.
			await confirm();
			await confirm();
			await confirm();
			expect(await rows()).toBe(3);
			await expectProblem(
				await send("POST", `/recurring/${item.id}/confirm`, {}),
				409,
				"conflict",
			);
		});
	});

	it("stores recurring income on its UTC day in a zone east of UTC", async () => {
		const tokyo = { ...as, "x-timezone": "Asia/Tokyo" };
		const tokyoDay = (daysBack: number) =>
			new Date(Date.now() + 9 * 3_600_000 - daysBack * 86_400_000)
				.toISOString()
				.slice(0, 10);
		const due = tokyoDay(1);
		const item = await make(
			{ name: "Tokyo pay", amount: "300", direction: "in", nextDueDate: due },
			tokyo,
		);
		const stored = () =>
			adminDb.recurringTemplate.findUniqueOrThrow({ where: { id: item.id } });
		expect((await stored()).nextDueDate.toISOString()).toBe(
			`${due}T00:00:00.000Z`,
		);

		// An edit keeps the same convention.
		const moved = tokyoDay(2);
		await expectBody<Item>(
			await send(
				"PATCH",
				`/recurring/${item.id}`,
				{ nextDueDate: moved },
				tokyo,
			),
			c.update,
		);
		expect((await stored()).nextDueDate.toISOString()).toBe(
			`${moved}T00:00:00.000Z`,
		);

		// The first period books on its own day, not the day before.
		const done = await expectBody<Confirm>(
			await send("POST", `/recurring/${item.id}/confirm`, {}, tokyo),
			c.confirm,
		);
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: done.confirmed.expenseId },
		});
		expect(row.date.toISOString().slice(0, 10)).toBe(moved);

		// An expense template keeps the start of the day in the user's own zone
		// (no zone saved here: the default), not the request's Tokyo.
		const expense = await make({ name: "Tokyo bill", nextDueDate: due }, tokyo);
		const bill = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id: expense.id },
		});
		expect(bill.nextDueDate.toISOString()).toBe(
			parseDateOnlyIn(due, defaultTimeZone()).toISOString(),
		);
		expect(bill.nextDueDate.toISOString()).not.toBe(
			new Date(`${due}T00:00:00.000+09:00`).toISOString(),
		);
	});

	it("books on the day it was paid and the undo still rewinds the template", async () => {
		const item = await make({ name: "Paid late", nextDueDate: daysAgo(5) });
		const paidOn = daysAgo(1);
		await expectProblem(
			await send("POST", `/recurring/${item.id}/confirm`, {
				paidOn: new Date(Date.now() + 2 * 86_400_000)
					.toISOString()
					.slice(0, 10),
			}),
			400,
			"bad_request",
		);
		await expect(
			adminDb.expense.count({ where: { recurringTemplateId: item.id } }),
		).resolves.toBe(0);
		const done = await expectBody<Confirm>(
			await send("POST", `/recurring/${item.id}/confirm`, {
				dueAt: item.dueAt,
				paidOn,
			}),
			c.confirm,
		);
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: done.confirmed.expenseId },
		});
		expect(row.date.toISOString().slice(0, 10)).toBe(paidOn);
		const moved = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id: item.id },
		});
		// The template moves on from its due date, not from the day it was paid.
		expect(moved.nextDueDate.getTime()).toBeGreaterThan(
			new Date(item.dueAt).getTime(),
		);
		await expectBody(
			await send("POST", "/recurring/undo", { token: done.undo }),
			c.undo,
		);
		await expect(
			adminDb.expense.count({ where: { id: done.confirmed.expenseId } }),
		).resolves.toBe(0);
		const back = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id: item.id },
		});
		expect(back.nextDueDate.toISOString()).toBe(item.dueAt);
	});

	it.each(["out", "in"] as const)(
		"refuses a paid-on day before the previous due day (%s)",
		async (direction) => {
			const item = await make({
				name: `Too early ${direction}`,
				frequency: "WEEKLY",
				direction,
				nextDueDate: daysAgo(5),
			});
			// The item says where the pickable days start: one period before the due day.
			expect(item.paidOnFrom).toBe(daysAgo(12));
			await expectProblem(
				await send("POST", `/recurring/${item.id}/confirm`, {
					dueAt: item.dueAt,
					paidOn: daysAgo(13),
				}),
				400,
				"bad_request",
			);
			await expect(
				adminDb.expense.count({ where: { recurringTemplateId: item.id } }),
			).resolves.toBe(0);
			// The first allowed day books.
			const done = await expectBody<Confirm>(
				await send("POST", `/recurring/${item.id}/confirm`, {
					dueAt: item.dueAt,
					paidOn: item.paidOnFrom,
				}),
				c.confirm,
			);
			expect(done.confirmed.expenseId).toEqual(expect.any(String));
		},
	);

	it("refuses a skip that does not say which due date it skips", async () => {
		const item = await make({ name: "Skip no guard", nextDueDate: daysAgo(2) });
		await expectProblem(
			await send("POST", `/recurring/${item.id}/skip`, {}),
			400,
			"validation_failed",
		);
		await expect(
			adminDb.recurringTemplate.findUniqueOrThrow({ where: { id: item.id } }),
		).resolves.toMatchObject({ nextDueDate: new Date(item.dueAt) });
	});

	it("books recurring income on its paid-on day and undoes it", async () => {
		const item = await make({
			name: "Late pay",
			amount: "900",
			direction: "in",
			nextDueDate: daysAgo(6),
		});
		const paidOn = daysAgo(2);
		const done = await expectBody<Confirm>(
			await send("POST", `/recurring/${item.id}/confirm`, { paidOn }),
			c.confirm,
		);
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: done.confirmed.expenseId },
		});
		expect(row.date.toISOString()).toBe(`${paidOn}T00:00:00.000Z`);
		await expectBody(
			await send("POST", "/recurring/undo", { token: done.undo }),
			c.undo,
		);
		const back = await adminDb.recurringTemplate.findUniqueOrThrow({
			where: { id: item.id },
		});
		expect(back.nextDueDate.toISOString()).toBe(item.dueAt);
	});

	it("keeps a fixed template fixed and takes the amount of a varying one with paid on", async () => {
		const fixed = await make({ name: "Fixed bill" });
		await expectProblem(
			await send("POST", `/recurring/${fixed.id}/confirm`, { amount: "99" }),
			400,
			"bad_request",
		);
		const varying = await make({ name: "Varying bill", amountMode: "ask" });
		const done = await expectBody<Confirm>(
			await send("POST", `/recurring/${varying.id}/confirm`, {
				amount: "31.25",
				paidOn: daysAgo(1),
			}),
			c.confirm,
		);
		const row = await adminDb.expense.findUniqueOrThrow({
			where: { id: done.confirmed.expenseId },
		});
		expect(row.amount.toString()).toBe("31.25");
		expect(row.date.toISOString().slice(0, 10)).toBe(daysAgo(1));
	});

	it.each([
		["expense", "out"],
		["income", "in"],
	] as const)(
		"skips a due %s after a preview, books nothing and undoes it",
		async (_n, direction) => {
			const item = await make({
				name: `Skip ${direction}`,
				direction,
				nextDueDate: daysAgo(4),
			});
			const preview = await expectBody<Preview>(
				await send("POST", `/recurring/${item.id}/skip/preview`, {
					dueAt: item.dueAt,
				}),
				c.previewSkip,
			);
			expect(preview.changes).toEqual([]);
			await expect(
				adminDb.recurringTemplate.findUniqueOrThrow({ where: { id: item.id } }),
			).resolves.toMatchObject({ nextDueDate: new Date(item.dueAt) });

			const done = await expectBody<{
				skipped: { templateId: string; skippedAt: string; nextDueAt: string };
				undo: string;
			}>(
				await send("POST", `/recurring/${item.id}/skip`, { dueAt: item.dueAt }),
				c.skip,
			);
			expect(done.skipped).toMatchObject({
				templateId: item.id,
				skippedAt: item.dueAt,
			});
			const moved = await adminDb.recurringTemplate.findUniqueOrThrow({
				where: { id: item.id },
			});
			expect(moved.nextDueDate.toISOString()).toBe(done.skipped.nextDueAt);
			expect(moved.nextDueDate.getTime()).toBeGreaterThan(
				new Date(item.dueAt).getTime(),
			);
			await expect(
				adminDb.expense.count({ where: { recurringTemplateId: item.id } }),
			).resolves.toBe(0);

			// The same skip again is refused, not applied to the next period.
			await expectProblem(
				await send("POST", `/recurring/${item.id}/skip`, { dueAt: item.dueAt }),
				409,
				"conflict",
			);

			await expectBody(
				await send("POST", "/recurring/skip/undo/preview", {
					token: done.undo,
				}),
				c.previewUndoSkip,
			);
			await expectBody(
				await send("POST", "/recurring/skip/undo", { token: done.undo }),
				c.undoSkip,
			);
			const back = await adminDb.recurringTemplate.findUniqueOrThrow({
				where: { id: item.id },
			});
			expect(back.nextDueDate.toISOString()).toBe(item.dueAt);
			// The token is spent.
			await expectProblem(
				await send("POST", "/recurring/skip/undo", { token: done.undo }),
				409,
				"conflict",
			);
		},
	);

	it("refuses to skip what is not due, and a skip undo after a later change", async () => {
		const later = await make({
			name: "Not due",
			nextDueDate: daysAgo(-20),
		});
		await expectProblem(
			await send("POST", `/recurring/${later.id}/skip`, { dueAt: later.dueAt }),
			409,
			"conflict",
		);

		const item = await make({
			name: "Skip then confirm",
			frequency: "WEEKLY",
			nextDueDate: daysAgo(10),
		});
		const skip = await expectBody<{ undo: string }>(
			await send("POST", `/recurring/${item.id}/skip`, { dueAt: item.dueAt }),
			c.skip,
		);
		await expectBody<Confirm>(
			await send("POST", `/recurring/${item.id}/confirm`, {}),
			c.confirm,
		);
		await expectProblem(
			await send("POST", "/recurring/skip/undo", { token: skip.undo }),
			409,
			"conflict",
		);
	});

	it("keeps skip to the owner and to write:money", async () => {
		const item = await make({ name: "Skip scopes" });
		await expectProblem(
			await send(
				"POST",
				`/recurring/${item.id}/skip`,
				{ dueAt: item.dueAt },
				asOther,
			),
			404,
			"not_found",
		);
		await expectProblem(
			await send(
				"POST",
				`/recurring/${item.id}/skip/preview`,
				{ dueAt: item.dueAt },
				asOther,
			),
			404,
			"not_found",
		);
		const expensesOnly = await asKey(userId, ["read", "write:expenses"]);
		await expectProblem(
			await send(
				"POST",
				`/recurring/${item.id}/skip`,
				{ dueAt: item.dueAt },
				expensesOnly,
			),
			403,
			"missing_scope",
		);
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
