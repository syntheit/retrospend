/**
 * The envelope budget end to end on a real Postgres (USD book, so values
 * need no rate): setup through the preview runner, money in and spending
 * read by the budget filters, assign / move / undo with caps and idempotent
 * retries, the registered figures, the router behind its flag, and the
 * migration applied twice.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { envelopeRouter } from "~/server/api/routers/envelope";
import { createCallerFactory } from "~/server/api/trpc";
import { readFigures } from "~/server/figures/read";
import { forUser } from "~/server/services/preview";
import { updateAppSettings } from "~/server/services/settings";
import { adminDb } from "~/test/pg-harness";
import { addRow, seedUser, setupInput } from "./__tests__/pg-fixture";
import { EnvelopeError } from "./errors";
import { assignEnvelopes, moveMoney, undoMovements } from "./movement.mutation";
import { getHistory, getMonth } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";

const usd = (minor: number) => ({ minor, currency: "USD" });

const envelopeIds = async (userId: string) => {
	const rows = await adminDb.envelope.findMany({
		where: { book: { createdById: userId } },
	});
	return Object.fromEntries(rows.map((e) => [e.name, e.id])) as Record<
		string,
		string
	>;
};

const leftOf = (month: Awaited<ReturnType<typeof getMonth>>, id: string) =>
	month?.groups.flatMap((g) => g.envelopes).find((e) => e.id === id)?.left
		.minor;

describe("envelope budget on Postgres", () => {
	let s: Awaited<ReturnType<typeof seedUser>>;
	let ids: Record<string, string>;
	const batch = randomUUID();
	let month: number;

	beforeAll(async () => {
		s = await seedUser();
	});

	it("a setup preview writes nothing; apply writes the book with its starting money", async () => {
		const preview = await forUser(s.user.id).preview(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		expect(preview.value.bookId).toBeTruthy();
		await expect(
			adminDb.budgetBook.count({ where: { createdById: s.user.id } }),
		).resolves.toBe(0);

		const applied = await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		expect(applied.undo).toMatchObject({
			kind: "revert",
			mutation: "envelope.setup",
		});
		ids = await envelopeIds(s.user.id);
		const view = await getMonth(s.user.id);
		month = view?.month.key as number;
		expect(view?.toAssign).toMatchObject({
			amount: usd(100_000),
			poolName: "NOT_PLANNED_YET",
		});
		expect(view?.groups.map((g) => g.role)).toEqual(["BILLS", "SPENDING"]);
	});

	it("a second setup is refused (one personal book, D33)", async () => {
		await expect(
			forUser(s.user.id).apply(setupEnvelopeBook, {
				...setupInput(s),
				timeZone: "UTC",
			}),
		).rejects.toMatchObject({ code: "BOOK_EXISTS" });
	});

	it("counts income and hidden-from-reports spending; ignores Not spending; refunds net (B6, C24)", async () => {
		await addRow(s.user.id, {
			amount: 2_000,
			direction: "IN",
			inType: "INCOME",
		});
		await addRow(s.user.id, { amount: 30, categoryId: s.dining });
		await addRow(s.user.id, {
			amount: 10,
			categoryId: s.dining,
			excludeFromAnalytics: true,
		});
		await addRow(s.user.id, {
			amount: 5,
			categoryId: s.dining,
			direction: "IN",
			inType: "REFUND",
		});
		await addRow(s.user.id, { amount: 500, entryKind: "NOT_SPENDING" });
		const view = await getMonth(s.user.id);
		// 1,000 starting money + 2,000 income; the 500 own transfer is nothing.
		expect(view?.toAssign.amount).toEqual(usd(300_000));
		// -30 - 10 hidden + 5 refund.
		expect(leftOf(view, ids.Dining as string)).toBe(-3_500);
	});

	it("assign preview shows the change and writes nothing; apply writes one batch", async () => {
		const input = {
			batchId: batch,
			month,
			mode: "add" as const,
			items: [
				{
					id: randomUUID(),
					envelopeId: ids.Rent as string,
					amountMinor: 50_000,
				},
				{
					id: randomUUID(),
					envelopeId: ids.Dining as string,
					amountMinor: 20_000,
				},
			],
		};
		const preview = await forUser(s.user.id).preview(assignEnvelopes, input);
		expect(
			preview.changes.find((c) => c.id === "budget.notPlannedYet"),
		).toMatchObject({ before: usd(300_000), after: usd(230_000) });
		await expect(
			adminDb.budgetMovement.count({ where: { batchId: batch } }),
		).resolves.toBe(0);

		const applied = await forUser(s.user.id).apply(assignEnvelopes, input);
		expect(applied.value.toAssign).toEqual({
			before: usd(300_000),
			after: usd(230_000),
		});
		expect(applied.value.envelopes).toContainEqual({
			id: ids.Dining,
			before: usd(-3_500),
			after: usd(16_500),
		});
		// A retry with the same batch id writes nothing more.
		const again = await forUser(s.user.id).apply(assignEnvelopes, input);
		expect(again.value.movements).toHaveLength(2);
		await expect(
			adminDb.budgetMovement.count({ where: { batchId: batch } }),
		).resolves.toBe(2);
	});

	it("S15 a move out caps at what the envelope holds", async () => {
		const over = {
			id: randomUUID(),
			month,
			from: ids.Dining as string,
			to: ids.Spending as string,
			amountMinor: 20_000,
			kind: "MOVE" as const,
		};
		const error = await forUser(s.user.id)
			.apply(moveMoney, over)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(EnvelopeError);
		expect(error).toMatchObject({ code: "OVER_CAP", availableMinor: 16_500 });
		await forUser(s.user.id).apply(moveMoney, {
			...over,
			id: randomUUID(),
			amountMinor: 10_000,
		});
		expect(leftOf(await getMonth(s.user.id), ids.Dining as string)).toBe(6_500);
	});

	it("D22 only this month and the next take movements", async () => {
		const at = (m: number) => ({
			id: randomUUID(),
			month: m,
			from: null,
			to: ids.Rent as string,
			amountMinor: 100,
			kind: "COVER" as const,
		});
		const before = month % 100 === 1 ? month - 89 : month - 1;
		await expect(
			forUser(s.user.id).apply(moveMoney, at(before)),
		).rejects.toMatchObject({ code: "MONTH_CLOSED" });
		const twoAhead = month % 100 >= 11 ? month + 90 : month + 2;
		await expect(
			forUser(s.user.id).apply(moveMoney, at(twoAhead)),
		).rejects.toMatchObject({ code: "INVALID" });
	});

	it("undo mirrors a whole batch once; a second undo is refused", async () => {
		const undo = { id: randomUUID(), target: { batchId: batch } };
		const done = await forUser(s.user.id).apply(undoMovements, undo);
		expect(done.value.toAssign.after).toEqual(usd(300_000));
		// 65 left minus the 200 the batch had put in: the mirror is exact (B5).
		expect(leftOf(await getMonth(s.user.id), ids.Dining as string)).toBe(
			-13_500,
		);
		await expect(
			forUser(s.user.id).apply(undoMovements, {
				id: randomUUID(),
				target: { batchId: batch },
			}),
		).rejects.toMatchObject({ code: "ALREADY_UNDONE" });
		// Retrying the same undo is a no-op.
		const retry = await forUser(s.user.id).apply(undoMovements, undo);
		expect(retry.value.movements).toHaveLength(2);
		const history = await getHistory(s.user.id, { limit: 50 });
		expect(history.items.filter((i) => i.kind === "UNDO")).toHaveLength(2);
		expect(
			history.items.filter((i) => i.batchId === batch).every((i) => !i.canUndo),
		).toBe(true);
	});
});

describe("figure budget.notPlannedYet", () => {
	it("is the pool of the current month, null without a book", async () => {
		const s = await seedUser();
		await expect(
			readFigures(s.user.id, ["budget.notPlannedYet"]),
		).resolves.toEqual(new Map([["budget.notPlannedYet", null]]));
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		const r = await readFigures(s.user.id, ["budget.notPlannedYet"]);
		expect(r.get("budget.notPlannedYet")).toEqual([usd(100_000)]);
	});
});

describe("figure budget.leftToSpend", () => {
	it("is the Spending group's Left minus a negative pool", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			startingMoneyMinor: 0,
			timeZone: "UTC",
		});
		const ids = await envelopeIds(s.user.id);
		const month = (await getMonth(s.user.id))?.month.key as number;
		await forUser(s.user.id).apply(assignEnvelopes, {
			batchId: randomUUID(),
			month,
			mode: "set",
			items: [
				{
					id: randomUUID(),
					envelopeId: ids.Dining as string,
					amountMinor: 20_000,
				},
			],
		});
		// Spending holds 200, but nothing came in: 200 - 200 planned too much = 0.
		const r = await readFigures(s.user.id, [
			"budget.leftToSpend",
			"budget.notPlannedYet",
		]);
		expect(r.get("budget.leftToSpend")).toEqual([usd(0)]);
		expect(r.get("budget.notPlannedYet")).toEqual([usd(-20_000)]);
	});
});

describe("figure envelope.left", () => {
	it("narrows to one envelope", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		const ids = await envelopeIds(s.user.id);
		await addRow(s.user.id, { amount: 12, categoryId: s.dining });
		const r = await readFigures(s.user.id, ["envelope.left"], {
			envelopeId: ids.Dining,
		});
		expect(r.get("envelope.left")).toEqual([usd(-1_200)]);
	});
});

describe("figure budget.leftThisWeek", () => {
	it("is null without weekly envelopes", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		const r = await readFigures(s.user.id, ["budget.leftThisWeek"]);
		expect(r.get("budget.leftThisWeek")).toBeNull();
	});

	it("sums Left this week of weekly envelopes", async () => {
		const s = await seedUser();
		const input = setupInput(s);
		input.style = "WEEKLY";
		const spending = input.envelopes[2];
		if (spending)
			spending.target = {
				kind: "MONTHLY",
				amountMinor: 0,
				mode: "REFILL",
				cadence: "WEEK",
			};
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...input,
			timeZone: "UTC",
		});
		const r = await readFigures(s.user.id, ["budget.leftThisWeek"]);
		expect(r.get("budget.leftThisWeek")).toEqual([usd(0)]);
	});
});

describe("envelope router", () => {
	const caller = (user: { id: string }) =>
		createCallerFactory(envelopeRouter)({
			session: { user: { ...user, role: "USER", isActive: true } },
			db: adminDb,
			headers: new Headers({ "x-timezone": "UTC" }),
		} as never);

	it("is closed while envelopeBudgetMode is OFF, open at ALL, and maps domain errors", async () => {
		const s = await seedUser();
		const c = caller(s.user);
		await expect(c.enabled()).resolves.toBe(false);
		await expect(c.getMonth({})).rejects.toMatchObject({ code: "FORBIDDEN" });

		await adminDb.appSettings.update({
			where: { id: "app_settings_singleton" },
			data: { envelopeBudgetMode: "ALL" },
		});
		await updateAppSettings({});
		try {
			await expect(c.getMonth({})).resolves.toBeNull();
			await c.setup(setupInput(s));
			await expect(c.getMonth({})).resolves.toMatchObject({
				toAssign: { amount: usd(100_000) },
			});
			await expect(c.setup(setupInput(s))).rejects.toMatchObject({
				code: "CONFLICT",
			});
		} finally {
			await adminDb.appSettings.update({
				where: { id: "app_settings_singleton" },
				data: { envelopeBudgetMode: "OFF" },
			});
			await updateAppSettings({});
		}
	});
});

describe("envelope_books migration", () => {
	it("applies twice without error (idempotent)", async () => {
		const sql = readFileSync(
			join(
				process.cwd(),
				"prisma/migrations/20261024000000_envelope_books/migration.sql",
			),
			"utf8",
		);
		const client = new Client({ connectionString: process.env.DATABASE_URL });
		await client.connect();
		try {
			await client.query(sql);
		} finally {
			await client.end();
		}
	});
});
