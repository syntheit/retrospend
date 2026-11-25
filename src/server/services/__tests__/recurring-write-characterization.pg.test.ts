/**
 * What recurring confirm and skip do today, pinned before the plan-post
 * refactor (slice-device-recurring.md, PR0). Nothing here is a wish: each
 * answer is what main gives now, reached on every transport that exists: the
 * web's tRPC `recurring.confirmAndCreate` and `recurring.skip`, v1
 * `POST /recurring/{id}/confirm` and `/skip`, and their `/preview` twins.
 *
 * The base case, derived by hand. Home ARS, preferred USD type blue, saved
 * zone Buenos Aires (UTC-3, no DST). Rates on the table:
 *   blue 1,500 on Nov 1, 1,540 on Nov 29, 1,545 on Nov 30; official 1,050 on Dec 1
 * (the official row is the newest, so only the preferred type picks blue).
 * A monthly USD 20 template on the 1st is due 2026-12-01T03:00Z (the start of
 * Dec 1 in Buenos Aires), "now" 2026-12-01T12:00Z.
 *   blue:     USD 20 * 1,545 = ARS 30,900.00   (official: 20 * 1,050 = 21,000.00)
 *   paid Nov 29 at blue 1,540: 20 * 1,540 = 30,800.00
 *   paid Nov 1 at blue 1,500:  20 * 1,500 = 30,000.00
 *   ask-me USD 18.50: 18.5 * 1,545 = 27,810 + 772.5 = 28,582.50
 * The next due date is Jan 1: 2027-01-01T03:00Z (the same month on the 1st).
 * Zone edges: Dec 1 starts at 03:00Z in Buenos Aires, 2026-11-30T15:00Z in
 * Tokyo (UTC+9) and 00:00Z in UTC. A confirm reads "is it due" in the zone of
 * the request, and steps the due date in the user's saved zone.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { bookedUser } from "~/server/api/v1/budget/__tests__/fixtures";
import { expectBody } from "~/server/api/v1/core/__tests__/harness";
import { createUserScopedDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { adminDb, fixtureDb, fixtureNameIndex } from "~/test/pg-harness";
import { confirmRecurringExpense } from "../recurring-confirm.mutation";
import { skipRecurring } from "../recurring-skip.mutation";
import {
	arsUser,
	BA,
	booked,
	iso,
	STAMPED,
	setRates,
	type TemplateData,
	TOKYO,
	templateState,
	trpcFor,
	usdTemplate,
	v1For,
} from "./recurring-write-kit";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const NOW = "2026-12-01T12:00:00.000Z";
const DUE = "2026-12-01T03:00:00.000Z";
const NEXT = "2027-01-01T03:00:00.000Z";
const ABSENT = "cabsent0000000000000000001";
const CONFIRMED = "This payment was already confirmed";
const SKIPPED = "This item was already confirmed or skipped";
const NOT_FOUND = "Recurring template not found";

const at = (instant: string) =>
	vi.useFakeTimers({ toFake: ["Date"], now: new Date(instant) });

beforeAll(async () => {
	await setRates([
		["2026-11-01", "ARS", "blue", "1500"],
		["2026-11-29", "ARS", "blue", "1540"],
		["2026-11-30", "ARS", "blue", "1545"],
		["2026-12-01", "ARS", "official", "1050"],
	]);
});
afterEach(() => vi.useRealTimers());

/** A manual template: it waits for a confirm, whatever the auto-pay sweep would do. */
const manual = (userId: string, data: TemplateData = {}) =>
	usdTemplate(userId, { autoPay: false, ...data });

type Args = { dueAt?: string; amount?: string; paidOn?: string };

const confirmViaTrpc = (
	trpc: Awaited<ReturnType<typeof trpcFor>>,
	id: string,
	a: Args = { dueAt: DUE },
) =>
	trpc.recurring.confirmAndCreate({
		id,
		dueDate: a.dueAt ? new Date(a.dueAt) : undefined,
		amount: a.amount === undefined ? undefined : Number(a.amount),
		paidOn: a.paidOn,
	});

const skipViaTrpc = (
	trpc: Awaited<ReturnType<typeof trpcFor>>,
	id: string,
	dueAt = DUE,
) => trpc.recurring.skip({ id, dueDate: new Date(dueAt) });

async function expectRefusal(
	res: Response,
	[status, code]: readonly [number, string],
	detail: string,
) {
	const body = (await res.json()) as unknown;
	expect(res.status, JSON.stringify(body)).toBe(status);
	expect(res.headers.get("content-type")).toBe("application/problem+json");
	expect(body).toMatchObject({ status, code, detail });
}

const row = (id: string, extra: object = {}) => ({
	title: "Rent",
	date: DUE,
	amount: "20",
	currency: "USD",
	usd: "20",
	rate: "1",
	rateType: "blue",
	homeCurrency: "ARS",
	homeRate: "1545",
	home: "30900",
	pricingSource: "RECURRING",
	status: "FINALIZED",
	direction: "OUT",
	inType: null,
	categoryId: null,
	excludeFromAnalytics: false,
	recurringTemplateId: id,
	...extra,
});

describe("a due confirm books the template's row", () => {
	it("tRPC: USD 20 at blue 1,545 is ARS 30,900.00, and the template moves to Jan 1", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const trpc = await trpcFor(me);
		at(NOW);
		const done = await confirmViaTrpc(trpc, id);
		expect(iso(done.dueAt)).toBe(DUE);
		expect(iso(done.nextDueAt)).toBe(NEXT);
		expect(done).toMatchObject({ templateId: id, anchorDay: 1 });
		expect(await booked(me)).toEqual([row(id)]);
		const after = await templateState(id);
		expect(after).toMatchObject({
			nextDueDate: NEXT,
			anchorDay: 1,
			expenses: 1,
		});
		// updateMany moves @updatedAt: a stamp read before a confirm is stale after it.
		expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(
			STAMPED.getTime(),
		);
	});

	it("v1: the same row and template, and the preview twin changes nothing", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const v1 = await v1For(me);
		at(NOW);
		const preview = await expectBody<{
			changes: { id: string; delta: { minor: number; currency: string } }[];
		}>(
			await v1("POST", `/recurring/${id}/confirm/preview`, { dueAt: DUE }),
			contract.recurring.previewConfirm,
		);
		// The spent figure is in USD whatever the home currency: the row's
		// amountInUSD 20.00 is 2,000 minor units, not the ARS 30,900.00 it books.
		expect(preview.changes.find((c) => c.id === "spent")?.delta).toEqual({
			minor: 2000,
			currency: "USD",
		});
		expect(await booked(me)).toEqual([]);
		expect(await templateState(id)).toMatchObject({
			nextDueDate: DUE,
			updatedAt: iso(STAMPED),
		});

		const done = await expectBody<{
			confirmed: Record<string, unknown>;
			undo: string;
		}>(
			await v1("POST", `/recurring/${id}/confirm`, { dueAt: DUE }),
			contract.recurring.confirm,
		);
		expect(done.confirmed).toMatchObject({
			templateId: id,
			direction: "out",
			nextDueAt: NEXT,
		});
		expect(done.undo).toEqual(expect.any(String));
		expect(await booked(me)).toEqual([row(id)]);
		const after = await templateState(id);
		expect(after).toMatchObject({
			nextDueDate: NEXT,
			anchorDay: 1,
			expenses: 1,
		});
		expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(
			STAMPED.getTime(),
		);
	});

	it("a user who prefers official books ARS 21,000.00 (20 * 1,050)", async () => {
		const me = await arsUser(BA, "official");
		const id = await manual(me);
		at(NOW);
		await confirmViaTrpc(await trpcFor(me), id);
		expect(await booked(me)).toEqual([
			row(id, { rateType: "official", homeRate: "1050", home: "21000" }),
		]);
	});

	it("a varying amount books what was typed: USD 18.50 is ARS 28,582.50", async () => {
		const me = await arsUser();
		const id = await manual(me, { amountMode: "ASK" });
		const v1 = await v1For(me);
		at(NOW);
		await expectBody(
			await v1("POST", `/recurring/${id}/confirm`, {
				dueAt: DUE,
				amount: "18.50",
			}),
			contract.recurring.confirm,
		);
		expect(await booked(me)).toEqual([
			row(id, { amount: "18.5", usd: "18.5", home: "28582.5" }),
		]);
	});

	it("paid on Nov 29 books that day at that day's blue 1,540 (30,800.00), and the template still steps from the due date", async () => {
		const me = await arsUser();
		const id = await manual(me);
		at(NOW);
		await confirmViaTrpc(await trpcFor(me), id, {
			dueAt: DUE,
			paidOn: "2026-11-29",
		});
		expect(await booked(me)).toEqual([
			row(id, {
				date: "2026-11-29T03:00:00.000Z",
				homeRate: "1540",
				home: "30800",
			}),
		]);
		expect(await templateState(id)).toMatchObject({ nextDueDate: NEXT });
	});

	it("the previous due day itself is allowed: paid Nov 1 at blue 1,500 is 30,000.00", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const v1 = await v1For(me);
		at(NOW);
		await expectBody(
			await v1("POST", `/recurring/${id}/confirm`, {
				dueAt: DUE,
				paidOn: "2026-11-01",
			}),
			contract.recurring.confirm,
		);
		expect(await booked(me)).toEqual([
			row(id, {
				date: "2026-11-01T03:00:00.000Z",
				homeRate: "1500",
				home: "30000",
			}),
		]);
	});

	it("an excludeByDefault category does not reach the row: excludeFromAnalytics stays false", async () => {
		const me = await arsUser();
		const category = await fixtureDb.category.create({
			data: {
				userId: me,
				name: "Transfers",
				color: "emerald",
				excludeByDefault: true,
				nameIndex: await fixtureNameIndex(me, "Transfers"),
			},
		});
		const [viaTrpc, viaV1] = [
			await manual(me, { categoryId: category.id }),
			await manual(me, { categoryId: category.id, name: "Rent two" }),
		];
		const v1 = await v1For(me);
		at(NOW);
		await confirmViaTrpc(await trpcFor(me), viaTrpc);
		await expectBody(
			await v1("POST", `/recurring/${viaV1}/confirm`, { dueAt: DUE }),
			contract.recurring.confirm,
		);
		const rows = await booked(me);
		expect(rows).toHaveLength(2);
		for (const r of rows)
			expect(r).toMatchObject({
				categoryId: category.id,
				excludeFromAnalytics: false,
			});
	});

	it("the web's confirm books recurring income as money in at an instant where a skip of the same day is refused", async () => {
		const me = await arsUser();
		// Income keeps its day as UTC midnight: Dec 1, 00:00Z.
		const id = await manual(me, {
			name: "Salary",
			direction: "IN",
			anchorDay: null,
			nextDueDate: new Date("2026-12-01T00:00:00.000Z"),
		});
		const trpc = await trpcFor(me);
		// 17:00 on Nov 30 in Buenos Aires: the zone's day is not Dec 1 yet.
		at("2026-11-30T20:00:00.000Z");
		await expect(
			skipViaTrpc(trpc, id, "2026-12-01T00:00:00.000Z"),
		).rejects.toMatchObject({ code: "CONFLICT", message: SKIPPED });
		// A confirm asks "has its day started" of the start of the next day: it books.
		await confirmViaTrpc(trpc, id, { dueAt: "2026-12-01T00:00:00.000Z" });
		expect(await booked(me)).toEqual([
			row(id, {
				title: "Salary",
				date: "2026-12-01T00:00:00.000Z",
				direction: "IN",
				inType: "INCOME",
			}),
		]);
		expect(await templateState(id)).toMatchObject({
			nextDueDate: "2027-01-01T00:00:00.000Z",
			anchorDay: 1,
		});
	});
});

type Want = {
	trpc: readonly [code: string, message: string];
	v1: readonly [status: number, code: string];
};
interface Refusal extends Want {
	name: string;
	owner?: "other" | "absent";
	template?: TemplateData;
	/** Changes to the caller's user row. */
	user?: Record<string, string>;
	now?: string;
	args?: Args;
}

const GONE: Want = {
	trpc: ["NOT_FOUND", NOT_FOUND],
	v1: [404, "not_found"],
};
const STALE: Want = {
	trpc: ["CONFLICT", CONFIRMED],
	v1: [409, "recurring_already_posted"],
};
const NOT_DUE: Want = {
	trpc: ["CONFLICT", CONFIRMED],
	v1: [409, "recurring_not_due"],
};
const BAD = (message: string): Want => ({
	trpc: ["BAD_REQUEST", message],
	v1: [400, "bad_request"],
});
const ASK_AMOUNT = "Confirm the amount for this recurring entry";
const FIXED_AMOUNT = "This recurring amount is fixed";
const FUTURE = "The date cannot be in the future";
const TOO_EARLY = "The date is before the previous due date";
const BEFORE_DUE = "2026-12-01T02:00:00.000Z";

const CONFIRM_REFUSALS: Refusal[] = [
	{ name: "an id that does not exist", owner: "absent", ...GONE },
	{ name: "another user's template", owner: "other", ...GONE },
	{ name: "a paused template", template: { isActive: false }, ...GONE },
	{
		name: "a paused template with a stale dueAt is 404, not a conflict",
		template: { isActive: false },
		args: { dueAt: "2026-11-01T03:00:00.000Z" },
		...GONE,
	},
	{
		name: "a dueAt one period back",
		args: { dueAt: "2026-11-01T03:00:00.000Z" },
		...STALE,
	},
	{ name: "a dueAt one period ahead", args: { dueAt: NEXT }, ...STALE },
	{
		name: "a day that has not started in the request zone",
		now: BEFORE_DUE,
		...NOT_DUE,
	},
	{
		name: "a day that starts one millisecond later",
		now: "2026-12-01T02:59:59.999Z",
		...NOT_DUE,
	},
	{
		name: "ask-me with no amount",
		template: { amountMode: "ASK" },
		...BAD(ASK_AMOUNT),
	},
	{
		name: "a fixed template given an amount",
		args: { dueAt: DUE, amount: "18.50" },
		...BAD(FIXED_AMOUNT),
	},
	{
		name: "paid on tomorrow",
		args: { dueAt: DUE, paidOn: "2026-12-02" },
		...BAD(FUTURE),
	},
	{
		name: "paid before the previous due day",
		args: { dueAt: DUE, paidOn: "2026-10-31" },
		...BAD(TOO_EARLY),
	},
	{
		name: "a currency with no rate at all",
		template: { currency: "COP" },
		trpc: ["BAD_REQUEST", "No exchange rate available for COP"],
		v1: [422, "missing_rate"],
	},
	{
		name: "a home currency with no rate",
		user: { homeCurrency: "UYU" },
		trpc: ["BAD_REQUEST", "No exchange rate available for UYU"],
		v1: [422, "missing_rate"],
	},
	// Each check in the order the mutation runs them: template, dueAt, due day, entry.
	{
		name: "not due and ask-me with no amount: not due answers first",
		template: { amountMode: "ASK" },
		now: BEFORE_DUE,
		args: { dueAt: DUE },
		...NOT_DUE,
	},
	{
		name: "a stale dueAt and ask-me with no amount: the dueAt answers first",
		template: { amountMode: "ASK" },
		args: { dueAt: NEXT },
		...STALE,
	},
	{
		name: "not due and paid on tomorrow: not due answers first",
		now: BEFORE_DUE,
		args: { dueAt: DUE, paidOn: "2026-12-02" },
		...NOT_DUE,
	},
	{
		name: "paid on tomorrow and ask-me with no amount: the paid-on day answers first",
		template: { amountMode: "ASK" },
		args: { dueAt: DUE, paidOn: "2026-12-02" },
		...BAD(FUTURE),
	},
	{
		name: "a paused ask-me template with no amount is 404",
		template: { isActive: false, amountMode: "ASK" },
		...GONE,
	},
];

/** The caller, a template to name, and what must stay as it was after a refusal. */
async function arranged(c: Refusal) {
	const me = await arsUser();
	if (c.user) await adminDb.user.update({ where: { id: me }, data: c.user });
	const other = await arsUser();
	const id =
		c.owner === "absent"
			? ABSENT
			: await manual(c.owner === "other" ? other : me, c.template);
	const owned = c.owner === "absent" ? null : id;
	return {
		me,
		other,
		id,
		before: owned ? await templateState(owned) : null,
		trpc: await trpcFor(me),
		v1: await v1For(me),
	};
}

async function expectUntouched(a: Awaited<ReturnType<typeof arranged>>) {
	if (a.before) expect(await templateState(a.id)).toEqual(a.before);
	expect(await booked(a.me)).toEqual([]);
	expect(await booked(a.other)).toEqual([]);
}

describe("confirm refusals, with the template and the books left as they were", () => {
	it.each(CONFIRM_REFUSALS)("$name", async (c) => {
		const a = await arranged(c);
		const args = c.args ?? { dueAt: DUE };
		at(c.now ?? NOW);
		await expect(confirmViaTrpc(a.trpc, a.id, args)).rejects.toMatchObject({
			code: c.trpc[0],
			message: c.trpc[1],
		});
		await expectRefusal(
			await a.v1("POST", `/recurring/${a.id}/confirm`, args),
			c.v1,
			c.trpc[1],
		);
		await expectRefusal(
			await a.v1("POST", `/recurring/${a.id}/confirm/preview`, args),
			c.v1,
			c.trpc[1],
		);
		await expectUntouched(a);
	});

	it("v1 refuses income-only options on an expense template", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const v1 = await v1For(me);
		at(NOW);
		for (const path of ["confirm", "confirm/preview"])
			await expectRefusal(
				await v1("POST", `/recurring/${id}/${path}`, {
					dueAt: DUE,
					rateType: "official",
					keep: true,
				}),
				[400, "bad_request"],
				"rateType, keep only apply to recurring income",
			);
		expect(await booked(me)).toEqual([]);
		expect(await templateState(id)).toMatchObject({ nextDueDate: DUE });
	});
});

const ALREADY_SKIPPED: Want = {
	trpc: ["CONFLICT", SKIPPED],
	v1: [409, "recurring_already_posted"],
};
const SKIP_NOT_DUE: Want = {
	trpc: ["CONFLICT", SKIPPED],
	v1: [409, "recurring_not_due"],
};

const SKIP_REFUSALS: (Omit<Refusal, "args"> & { dueAt?: string })[] = [
	{ name: "an id that does not exist", owner: "absent", ...GONE },
	{ name: "another user's template", owner: "other", ...GONE },
	{ name: "a paused template", template: { isActive: false }, ...GONE },
	{
		name: "a paused template with a stale dueAt is 404, not a conflict",
		template: { isActive: false },
		dueAt: "2026-11-01T03:00:00.000Z",
		...GONE,
	},
	{
		name: "a dueAt one period back",
		dueAt: "2026-11-01T03:00:00.000Z",
		...ALREADY_SKIPPED,
	},
	{ name: "a dueAt one period ahead", dueAt: NEXT, ...ALREADY_SKIPPED },
	{
		name: "a day that has not started in the request zone",
		now: BEFORE_DUE,
		...SKIP_NOT_DUE,
	},
	{
		name: "a day that starts one millisecond later",
		now: "2026-12-01T02:59:59.999Z",
		...SKIP_NOT_DUE,
	},
	{
		name: "a stale dueAt on an ask-me template",
		template: { amountMode: "ASK" },
		dueAt: NEXT,
		...ALREADY_SKIPPED,
	},
];

describe("skip refusals, with the template and the books left as they were", () => {
	it.each(SKIP_REFUSALS)("$name", async (c) => {
		const a = await arranged(c);
		const dueAt = c.dueAt ?? DUE;
		at(c.now ?? NOW);
		await expect(skipViaTrpc(a.trpc, a.id, dueAt)).rejects.toMatchObject({
			code: c.trpc[0],
			message: c.trpc[1],
		});
		for (const path of ["skip", "skip/preview"])
			await expectRefusal(
				await a.v1("POST", `/recurring/${a.id}/${path}`, { dueAt }),
				c.v1,
				c.trpc[1],
			);
		await expectUntouched(a);
	});

	it("income is due by the UTC day in the zone's calendar: refused at 23:59 on Nov 30 in Buenos Aires, allowed at midnight", async () => {
		const me = await arsUser();
		const id = await manual(me, {
			name: "Salary",
			direction: "IN",
			anchorDay: null,
			nextDueDate: new Date("2026-12-01T00:00:00.000Z"),
		});
		const trpc = await trpcFor(me);
		const v1 = await v1For(me);
		const dueAt = "2026-12-01T00:00:00.000Z";
		at("2026-12-01T02:59:59.999Z");
		await expect(skipViaTrpc(trpc, id, dueAt)).rejects.toMatchObject({
			code: "CONFLICT",
			message: SKIPPED,
		});
		await expectRefusal(
			await v1("POST", `/recurring/${id}/skip`, { dueAt }),
			[409, "recurring_not_due"],
			SKIPPED,
		);
		expect(await templateState(id)).toMatchObject({ nextDueDate: dueAt });
		at("2026-12-01T03:00:00.000Z");
		await skipViaTrpc(trpc, id, dueAt);
		expect(await templateState(id)).toMatchObject({
			nextDueDate: "2027-01-01T00:00:00.000Z",
			anchorDay: 1,
			expenses: 0,
		});
	});
});

describe("skip moves the template on and books nothing", () => {
	it("tRPC and v1 both step to Jan 1 in the saved zone and move @updatedAt", async () => {
		const me = await arsUser();
		const other = await arsUser();
		const [a, b] = [await manual(me), await manual(other)];
		const trpc = await trpcFor(me);
		const v1 = await v1For(other);
		at(NOW);
		const done = await skipViaTrpc(trpc, a);
		expect(iso(done.dueAt)).toBe(DUE);
		expect(iso(done.nextDueAt)).toBe(NEXT);
		const body = await expectBody<{
			skipped: { skippedAt: string; nextDueAt: string };
			undo: string;
		}>(
			await v1("POST", `/recurring/${b}/skip`, { dueAt: DUE }),
			contract.recurring.skip,
		);
		expect(body.skipped).toMatchObject({ skippedAt: DUE, nextDueAt: NEXT });
		for (const [owner, id] of [
			[me, a],
			[other, b],
		] as const) {
			const after = await templateState(id);
			expect(after).toMatchObject({
				nextDueDate: NEXT,
				anchorDay: 1,
				expenses: 0,
			});
			expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(
				STAMPED.getTime(),
			);
			expect(await booked(owner)).toEqual([]);
		}
	});

	it("the preview twin moves nothing", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const v1 = await v1For(me);
		at(NOW);
		await expectBody(
			await v1("POST", `/recurring/${id}/skip/preview`, { dueAt: DUE }),
			contract.recurring.previewSkip,
		);
		expect(await templateState(id)).toEqual({
			nextDueDate: DUE,
			anchorDay: 1,
			isActive: true,
			updatedAt: iso(STAMPED),
			expenses: 0,
		});
	});
});

describe("a repeat is refused, not booked for the next period", () => {
	it("confirm twice: the second is 409 on v1 and CONFLICT on tRPC, with one row", async () => {
		const me = await arsUser();
		const [a, b] = [await manual(me), await manual(me, { name: "Rent two" })];
		const trpc = await trpcFor(me);
		const v1 = await v1For(me);
		at(NOW);
		await confirmViaTrpc(trpc, a);
		await expect(confirmViaTrpc(trpc, a)).rejects.toMatchObject({
			code: "CONFLICT",
			message: CONFIRMED,
		});
		await expectBody(
			await v1("POST", `/recurring/${b}/confirm`, { dueAt: DUE }),
			contract.recurring.confirm,
		);
		await expectRefusal(
			await v1("POST", `/recurring/${b}/confirm`, { dueAt: DUE }),
			[409, "recurring_already_posted"],
			CONFIRMED,
		);
		expect(await booked(me)).toHaveLength(2);
	});

	it("skip twice: the second is refused and the template stays on Jan 1", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const trpc = await trpcFor(me);
		at(NOW);
		await skipViaTrpc(trpc, id);
		await expect(skipViaTrpc(trpc, id)).rejects.toMatchObject({
			code: "CONFLICT",
			message: SKIPPED,
		});
		expect(await templateState(id)).toMatchObject({ nextDueDate: NEXT });
	});

	it("two confirms of one due date at once: one books, the other is the same 409, on both transports", async () => {
		const me = await arsUser();
		const [a, b] = [await manual(me), await manual(me, { name: "Rent two" })];
		const trpc = await trpcFor(me);
		const v1 = await v1For(me);
		at(NOW);
		const viaTrpc = await Promise.allSettled([
			confirmViaTrpc(trpc, a),
			confirmViaTrpc(trpc, a),
		]);
		expect(viaTrpc.map((r) => r.status).sort()).toEqual([
			"fulfilled",
			"rejected",
		]);
		expect(viaTrpc.find((r) => r.status === "rejected")).toMatchObject({
			reason: { code: "CONFLICT", message: CONFIRMED },
		});
		const viaV1 = await Promise.all([
			v1("POST", `/recurring/${b}/confirm`, { dueAt: DUE }),
			v1("POST", `/recurring/${b}/confirm`, { dueAt: DUE }),
		]);
		expect(viaV1.map((r) => r.status).sort()).toEqual([200, 409]);
		expect(await booked(me)).toHaveLength(2);
		expect(await templateState(a)).toMatchObject({
			nextDueDate: NEXT,
			expenses: 1,
		});
		expect(await templateState(b)).toMatchObject({
			nextDueDate: NEXT,
			expenses: 1,
		});
	});
});

/** `run` with its template write preceded by `rival`, as another client's commit would be. */
function losingTo(
	userId: string,
	rival: () => Promise<unknown>,
	run: (
		tx: Parameters<typeof confirmRecurringExpense.run>[0],
	) => Promise<unknown>,
) {
	return userTransaction(createUserScopedDb(userId), userId, (tx) => {
		const template = new Proxy(tx.recurringTemplate, {
			get(target, prop) {
				const value = Reflect.get(target, prop, target) as unknown;
				if (prop !== "updateMany") return value;
				return async (args: never) => {
					await rival();
					return (target.updateMany as (a: never) => Promise<unknown>)(args);
				};
			},
		});
		return run(
			new Proxy(tx, {
				get(target, prop) {
					return prop === "recurringTemplate"
						? template
						: Reflect.get(target, prop, target);
				},
			}),
		);
	});
}

describe("a lost race: another client moves the template between the read and the write", () => {
	const rival = (id: string) => () =>
		fixtureDb.recurringTemplate.update({
			where: { id },
			data: { nextDueDate: new Date(NEXT) },
		});

	it("confirm is refused as already posted and books nothing", async () => {
		const me = await arsUser();
		const id = await manual(me);
		at(NOW);
		await expect(
			losingTo(me, rival(id), (tx) =>
				confirmRecurringExpense.run(
					tx,
					{ templateId: id, dueDate: new Date(DUE), timeZone: BA },
					{ userId: me },
				),
			),
		).rejects.toMatchObject({
			kind: "already_posted",
			message: CONFIRMED,
		});
		expect(await booked(me)).toEqual([]);
		expect(await templateState(id)).toMatchObject({
			nextDueDate: NEXT,
			expenses: 0,
		});
	});

	it("skip is refused as already posted", async () => {
		const me = await arsUser();
		const id = await manual(me);
		at(NOW);
		await expect(
			losingTo(me, rival(id), (tx) =>
				skipRecurring.run(
					tx,
					{ templateId: id, dueDate: new Date(DUE), timeZone: BA },
					{ userId: me },
				),
			),
		).rejects.toMatchObject({ kind: "already_posted", message: SKIPPED });
		expect(await templateState(id)).toMatchObject({ nextDueDate: NEXT });
	});
});

describe("auto: the sweep's confirm asks the template to still pay itself", () => {
	const auto = (me: string, id: string) =>
		forUser(me).apply(confirmRecurringExpense, {
			templateId: id,
			dueDate: new Date(DUE),
			auto: true,
		});

	it.each([
		["auto-pay off", { autoPay: false }],
		["ask-me with auto-pay on", { autoPay: true, amountMode: "ASK" as const }],
		["auto-pay off and ask-me", { autoPay: false, amountMode: "ASK" as const }],
	])("%s is 404 and books nothing", async (_label, template) => {
		const me = await arsUser();
		const id = await usdTemplate(me, template);
		at(NOW);
		await expect(auto(me, id)).rejects.toMatchObject({
			kind: "not_found",
			message: NOT_FOUND,
		});
		expect(await booked(me)).toEqual([]);
		expect(await templateState(id)).toMatchObject({
			nextDueDate: DUE,
			expenses: 0,
		});
	});

	it("auto-pay on with a fixed amount books the same row a manual confirm books", async () => {
		const me = await arsUser();
		const id = await usdTemplate(me, { autoPay: true });
		at(NOW);
		await auto(me, id);
		expect(await booked(me)).toEqual([row(id)]);
	});
});

describe("the zone of the request decides whether a day is due; the saved zone steps it", () => {
	it("Buenos Aires: refused at 02:59:59.999Z, books at 03:00:00.000Z", async () => {
		const me = await arsUser();
		const id = await manual(me);
		const trpc = await trpcFor(me, BA);
		at("2026-12-01T02:59:59.999Z");
		await expect(confirmViaTrpc(trpc, id)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		expect(await booked(me)).toEqual([]);
		at("2026-12-01T03:00:00.000Z");
		await confirmViaTrpc(trpc, id);
		expect(await booked(me)).toEqual([row(id)]);
	});

	it("a request from Tokyo at 2026-11-30T15:30Z (Dec 1, 00:30 there) books a Buenos Aires day that has not started; Buenos Aires does not", async () => {
		const [early, late] = [await arsUser(BA), await arsUser(BA)];
		const [a, b] = [await manual(early), await manual(late)];
		const [fromTokyo, fromBuenosAires] = [
			await trpcFor(early, TOKYO),
			await trpcFor(late, BA),
		];
		at("2026-11-30T15:30:00.000Z");
		await expect(confirmViaTrpc(fromBuenosAires, b)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		await confirmViaTrpc(fromTokyo, a);
		// Booked on the due date, stepped in the saved zone (Buenos Aires).
		expect((await booked(early)).map((r) => r.date)).toEqual([DUE]);
		expect(await templateState(a)).toMatchObject({
			nextDueDate: NEXT,
			anchorDay: 1,
		});
		expect(await templateState(b)).toMatchObject({ nextDueDate: DUE });
	});

	it("v1 reads x-timezone the same way: Tokyo books, UTC at 02:00Z on Dec 1 books", async () => {
		const [tokyo, utc] = [await arsUser(BA), await arsUser(BA)];
		const [a, b] = [await manual(tokyo), await manual(utc)];
		const [fromTokyo, fromUtc] = [
			await v1For(tokyo, TOKYO),
			await v1For(utc, "UTC"),
		];
		at("2026-11-30T15:30:00.000Z");
		await expectBody(
			await fromTokyo("POST", `/recurring/${a}/confirm`, { dueAt: DUE }),
			contract.recurring.confirm,
		);
		at(BEFORE_DUE);
		// 02:00Z is Dec 1 in UTC: the due check passes, though it is 23:00 on Nov 30 in Buenos Aires.
		await expectBody(
			await fromUtc("POST", `/recurring/${b}/confirm`, { dueAt: DUE }),
			contract.recurring.confirm,
		);
		for (const [owner, id] of [
			[tokyo, a],
			[utc, b],
		] as const) {
			expect((await booked(owner)).map((r) => r.date)).toEqual([DUE]);
			expect(await templateState(id)).toMatchObject({ nextDueDate: NEXT });
		}
	});

	it("paid on Dec 2 is tomorrow in Buenos Aires and today in Tokyo, where the day starts 2026-12-01T15:00Z", async () => {
		const [fromBa, fromTokyo] = [await arsUser(BA), await arsUser(BA)];
		const [a, b] = [await manual(fromBa), await manual(fromTokyo)];
		const args = { dueAt: DUE, paidOn: "2026-12-02" };
		at("2026-12-01T16:00:00.000Z");
		await expect(
			confirmViaTrpc(await trpcFor(fromBa, BA), a, args),
		).rejects.toMatchObject({ code: "BAD_REQUEST", message: FUTURE });
		await confirmViaTrpc(await trpcFor(fromTokyo, TOKYO), b, args);
		expect(await booked(fromTokyo)).toEqual([
			row(b, { date: "2026-12-01T15:00:00.000Z" }),
		]);
		expect(await templateState(b)).toMatchObject({ nextDueDate: NEXT });
	});

	it("saved zone Tokyo: the due date steps to 2026-12-31T15:00Z (Jan 1 starts there), not Buenos Aires' Jan 1", async () => {
		const me = await arsUser(TOKYO);
		const id = await manual(me);
		const trpc = await trpcFor(me);
		// Dec 1, 00:30 in Tokyo: its day has started though the instant is Nov 30 in Buenos Aires.
		at("2026-11-30T15:30:00.000Z");
		await confirmViaTrpc(trpc, id);
		expect(await booked(me)).toEqual([row(id)]);
		expect(await templateState(id)).toMatchObject({
			nextDueDate: "2026-12-31T15:00:00.000Z",
			anchorDay: 1,
		});
	});
});

describe("template ids and delete", () => {
	it("tRPC takes a cuid only: a uuid is BAD_REQUEST on id before anything runs, on confirm and skip", async () => {
		const me = await arsUser();
		const trpc = await trpcFor(me);
		const uuid = randomUUID();
		at(NOW);
		for (const run of [
			() => confirmViaTrpc(trpc, uuid),
			() => skipViaTrpc(trpc, uuid),
		]) {
			const error = (await run().catch((e: unknown) => e)) as {
				code: string;
				cause: { issues: { path: string[] }[] };
			};
			expect(error.code).toBe("BAD_REQUEST");
			expect(error.cause.issues.map((i) => i.path.join("."))).toEqual(["id"]);
		}
	});

	it("v1 reads the same uuid as a template that does not exist", async () => {
		const me = await arsUser();
		const v1 = await v1For(me);
		at(NOW);
		await expectRefusal(
			await v1("POST", `/recurring/${randomUUID()}/confirm`, { dueAt: DUE }),
			[404, "not_found"],
			NOT_FOUND,
		);
	});

	it("deleting a template a BILL envelope follows: tRPC and v1 end alike, but only v1 hands back an undo", async () => {
		const booked$ = await bookedUser();
		const me = booked$.user.id;
		const [viaTrpc, viaV1] = [
			await manual(me, { name: "Power", currency: "USD" }),
			await manual(me, { name: "Water", currency: "USD" }),
		];
		const bills = [
			[booked$.ids.Rent as string, viaTrpc],
			[booked$.ids.Dining as string, viaV1],
		] as const;
		const entries: Record<string, string> = {};
		for (const [envelopeId, templateId] of bills) {
			await adminDb.envelope.update({
				where: { id: envelopeId },
				data: { kind: "BILL", targetTemplateId: templateId },
			});
			const entry = await fixtureDb.expense.create({
				data: {
					userId: me,
					title: "Logged",
					amount: "20",
					currency: "USD",
					date: new Date(DUE),
					amountInUSD: "20",
					exchangeRate: "1",
					pricingSource: "RECURRING",
					recurringTemplateId: templateId,
				},
			});
			entries[templateId] = entry.id;
		}
		const trpc = await trpcFor(me);
		const v1 = await v1For(me);
		at(NOW);
		await expect(trpc.recurring.delete({ id: viaTrpc })).resolves.toEqual({
			success: true,
		});
		const done = await expectBody<{ undo?: string }>(
			await v1("DELETE", `/recurring/${viaV1}`),
			contract.recurring.delete,
		);
		expect(done.undo).toEqual(expect.any(String));
		for (const [envelopeId, templateId] of bills) {
			expect(
				await fixtureDb.recurringTemplate.count({ where: { id: templateId } }),
			).toBe(0);
			// The envelope keeps its kind and loses its target; the entry stays, unlinked.
			expect(
				await adminDb.envelope.findUniqueOrThrow({ where: { id: envelopeId } }),
			).toMatchObject({ kind: "BILL", targetTemplateId: null });
			expect(
				await fixtureDb.expense.findUniqueOrThrow({
					where: { id: entries[templateId] },
				}),
			).toMatchObject({ recurringTemplateId: null });
		}
	});
});
