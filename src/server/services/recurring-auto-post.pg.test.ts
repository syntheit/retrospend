/**
 * Recurring auto-post on real Postgres (E2EE D11 PR 6.1). Each sweep is
 * limited to the users a test made (the `only` source), so templates other
 * files left in this worker's database never post here. Hand-derived values:
 *
 *   ARS home, default blue. Blue 1200 on 2027-03-01, official 1000 on
 *   2027-03-03, blue 1000 on 2027-06-01; due dates are Buenos Aires
 *   midnight (03:00Z).
 *     ARS 120,000 due 03-05 -> blue 1200 (the default type beats the newer
 *       official): 120000 / 1200 = USD 100.00, home ARS 120,000
 *     ARS 285 due 06-05     -> blue 1000: 285 / 1000 = 0.285, a tie, half to
 *       even = USD 0.28
 *     USD 12.99 due 03-05   -> home 12.99 * 1200 = ARS 15,588.00
 *   JPY home, official 150: USD 10.15 -> 1522.5 -> JPY 1522 (half to even);
 *     USD 10.05 -> 1507.5 -> JPY 1508; JPY 1500 -> 1500 / 150 = USD 10.00
 *   Catch-up, Buenos Aires, anchor 31, blue 1468 from 2028-01-01, due Jan
 *     31, now Mar 31 12:00Z: Jan 31, Feb 29 (2028 is a leap year), Mar 31,
 *     each ARS 1000 / 1468 = 0.6812 = USD 0.68; next Apr 30 03:00Z
 *   Cap: a weekly template from 2027-01-01 (UTC) with now Oct 1 has 40
 *     periods (Jan 1 + 7k, k = 0 to 39, the last Jan 1 + 273 days = Oct 1):
 *     31 in the first pass, then the template waits at Jan 1 + 217 days =
 *     Aug 6, and 9 in the next (Aug 6 to Oct 1), next Oct 8
 *   Santiago, weekly, due 2027-09-05T04:00Z (the gap day starts at 01:00,
 *     04:00Z): nothing at 03:59:59Z; at 04:00Z one post, next 09-12T03:00Z
 *   UYU home with no UYU rate: USD 12.99 does not post; with official 40,
 *     12.99 * 40 = UYU 519.60
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	AUTO_POST_GRACE_MS,
	recurringItems,
} from "~/server/services/needs-you/activity";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
import {
	AUTO_POST_STATUS_KEY,
	type RecurringAutoPostResult,
	sweepRecurringAutoPost,
} from "./recurring-auto-post";
import { confirmRecurringExpense } from "./recurring-confirm.mutation";

const BA = "America/Argentina/Buenos_Aires";
const ba = (day: string) => new Date(`${day}T03:00:00.000Z`);
const NONE: RecurringAutoPostResult = {
	posted: 0,
	raced: 0,
	missingRate: 0,
	retry: 0,
	capped: 0,
	failed: 0,
};

beforeAll(async () => {
	await adminDb.exchangeRate.createMany({
		data: [
			["2027-03-01", "ARS", "blue", "1200"],
			["2027-03-03", "ARS", "official", "1000"],
			["2027-06-01", "ARS", "blue", "1000"],
			["2028-01-01", "ARS", "blue", "1468"],
			["2027-01-01", "JPY", "official", "150"],
		].map(([day, currency, type, rate]) => ({
			date: new Date(`${day}T00:00:00.000Z`),
			currency: currency as string,
			type: type as string,
			rate: rate as string,
		})),
	});
});
afterEach(() => vi.useRealTimers());
afterAll(() => vi.restoreAllMocks());

async function user(homeCurrency: string, timeZone: string) {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency, timeZone },
	});
	return user.id;
}

type TemplateData = Partial<Prisma.RecurringTemplateUncheckedCreateInput>;

async function template(userId: string, data: TemplateData) {
	const row = await fixtureDb.recurringTemplate.create({
		data: {
			userId,
			name: "Rent",
			amount: "10",
			currency: "USD",
			frequency: "MONTHLY",
			nextDueDate: ba("2027-03-05"),
			...data,
		},
	});
	return row.id;
}

type Source = Parameters<typeof sweepRecurringAutoPost>[1];

/** The real id read, kept to `userIds`; `then` runs after the read, before any post. */
function only(userIds: string[], then?: () => Promise<unknown>): Source {
	return {
		$queryRaw: (async (...args: Parameters<typeof adminDb.$queryRaw>) => {
			const rows = (await adminDb.$queryRaw(...args)) as { userId: string }[];
			await then?.();
			return rows.filter((r) => userIds.includes(r.userId));
		}) as typeof adminDb.$queryRaw,
	};
}

function sweep(now: Date, userIds: string[], then?: () => Promise<unknown>) {
	vi.useFakeTimers({ toFake: ["Date"], now });
	return sweepRecurringAutoPost(now, only(userIds, then));
}

const iso = (d: Date) => d.toISOString();
const dueOf = async (id: string) =>
	iso(
		(await fixtureDb.recurringTemplate.findUniqueOrThrow({ where: { id } }))
			.nextDueDate,
	);

/** Each expense of a user as stored, oldest first. */
async function booked(userId: string) {
	const rows = await fixtureDb.expense.findMany({
		where: { userId },
		orderBy: { date: "asc" },
	});
	return rows.map((e) => ({
		date: iso(e.date),
		amount: e.amount.toString(),
		currency: e.currency,
		usd: e.amountInUSD.toFixed(2),
		rate: e.exchangeRate?.toString(),
		rateType: e.rateType,
		home: e.homeAmount?.toString(),
		direction: e.direction,
		inType: e.inType,
	}));
}

describe("figures match a manual confirm", () => {
	it("books an ARS user's blue rate, the half-even cent and the home leg", async () => {
		const me = await user("ARS", BA);
		await template(me, { amount: "120000", currency: "ARS" });
		await template(me, {
			amount: "285",
			currency: "ARS",
			nextDueDate: ba("2027-06-05"),
		});
		await template(me, { amount: "12.99" });
		const result = await sweep(new Date("2027-06-05T12:00:00Z"), [me]);
		// Monthly templates due Mar 5 post Mar, Apr, May and Jun 5.
		expect(result).toEqual({ ...NONE, posted: 9 });
		const rows = await booked(me);
		const march = rows.filter((r) => r.date === "2027-03-05T03:00:00.000Z");
		expect(march).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					amount: "120000",
					rate: "1200",
					rateType: "blue",
					usd: "100.00",
					home: "120000",
				}),
				expect.objectContaining({
					amount: "12.99",
					rate: "1",
					rateType: "blue",
					usd: "12.99",
					home: "15588",
				}),
			]),
		);
		const tie = rows.filter((r) => r.amount === "285");
		expect(tie).toEqual([
			expect.objectContaining({
				date: "2027-06-05T03:00:00.000Z",
				rate: "1000",
				usd: "0.28",
				home: "285",
			}),
		]);
	});

	it("rounds a JPY home half to even, to whole yen", async () => {
		const me = await user("JPY", "Asia/Tokyo");
		const due = new Date("2027-03-04T15:00:00.000Z"); // Mar 5 in Tokyo
		await template(me, { amount: "10.15", nextDueDate: due });
		await template(me, { amount: "10.05", nextDueDate: due });
		await template(me, { amount: "1500", currency: "JPY", nextDueDate: due });
		await sweep(new Date("2027-03-05T00:00:00Z"), [me]);
		expect(
			(await booked(me)).map((r) => [r.amount, r.usd, r.home]).sort(),
		).toEqual([
			["10.05", "10.05", "1508"],
			["10.15", "10.15", "1522"],
			["1500", "10.00", "1500"],
		]);
	});
});

describe("due dates in the saved zone", () => {
	it("catches up after downtime: Jan 31, Feb 29 and Mar 31 in one pass", async () => {
		const me = await user("ARS", BA);
		const id = await template(me, {
			amount: "1000",
			currency: "ARS",
			nextDueDate: ba("2028-01-31"),
			anchorDay: 31,
		});
		const result = await sweep(new Date("2028-03-31T12:00:00Z"), [me]);
		expect(result).toEqual({ ...NONE, posted: 3 });
		expect((await booked(me)).map((r) => [r.date, r.rate, r.usd])).toEqual([
			["2028-01-31T03:00:00.000Z", "1468", "0.68"],
			["2028-02-29T03:00:00.000Z", "1468", "0.68"],
			["2028-03-31T03:00:00.000Z", "1468", "0.68"],
		]);
		expect(await dueOf(id)).toBe("2028-04-30T03:00:00.000Z");
	});

	it("posts 31 periods in a pass and the rest in the next", async () => {
		const me = await user("USD", "UTC");
		const id = await template(me, {
			frequency: "WEEKLY",
			nextDueDate: new Date("2027-01-01T00:00:00Z"),
		});
		const now = new Date("2027-10-01T12:00:00Z");
		expect(await sweep(now, [me])).toEqual({ ...NONE, posted: 31, capped: 1 });
		expect(await dueOf(id)).toBe("2027-08-06T00:00:00.000Z");
		expect(await sweep(now, [me])).toEqual({ ...NONE, posted: 9 });
		const dates = (await booked(me)).map((r) => r.date);
		expect(dates).toHaveLength(40);
		expect(new Set(dates).size).toBe(40);
		expect(dates.at(31)).toBe("2027-08-06T00:00:00.000Z");
		expect(dates.at(-1)).toBe("2027-10-01T00:00:00.000Z");
		expect(await dueOf(id)).toBe("2027-10-08T00:00:00.000Z");
	});

	it("posts Santiago's gap day at its first instant, not before", async () => {
		const me = await user("USD", "America/Santiago");
		const id = await template(me, {
			frequency: "WEEKLY",
			nextDueDate: new Date("2027-09-05T04:00:00Z"),
		});
		expect(await sweep(new Date("2027-09-05T03:59:59Z"), [me])).toEqual(NONE);
		expect(await sweep(new Date("2027-09-05T04:00:00Z"), [me])).toEqual({
			...NONE,
			posted: 1,
		});
		expect((await booked(me)).map((r) => r.date)).toEqual([
			"2027-09-05T04:00:00.000Z",
		]);
		expect(await dueOf(id)).toBe("2027-09-12T03:00:00.000Z");
	});
});

describe("each period books once", () => {
	const NOW = new Date("2027-03-05T12:00:00Z");

	it("when two sweeps run at once", async () => {
		const me = await user("USD", BA);
		await template(me, {});
		vi.useFakeTimers({ toFake: ["Date"], now: NOW });
		const results = await Promise.all([
			sweepRecurringAutoPost(NOW, only([me])),
			sweepRecurringAutoPost(NOW, only([me])),
		]);
		// The second either met the first's lock (raced) or read after its commit.
		expect(results.map((r) => r.posted).sort()).toEqual([0, 1]);
		expect(results.every((r) => r.failed === 0)).toBe(true);
		expect(await booked(me)).toHaveLength(1);
	});

	it("when a sweep races a tap on Confirm", async () => {
		const me = await user("USD", BA);
		const id = await template(me, {});
		vi.useFakeTimers({ toFake: ["Date"], now: NOW });
		await Promise.allSettled([
			sweepRecurringAutoPost(NOW, only([me])),
			forUser(me).apply(confirmRecurringExpense, {
				templateId: id,
				dueDate: ba("2027-03-05"),
			}),
		]);
		expect(await booked(me)).toHaveLength(1);
		expect(await dueOf(id)).toBe("2027-04-05T03:00:00.000Z");
	});
});

describe("what does not post", () => {
	const NOW = new Date("2027-03-05T12:00:00Z");

	it("leaves ask-me, manual, inactive and future templates alone", async () => {
		const me = await user("USD", BA);
		const ids = [
			await template(me, { amountMode: "ASK" }),
			await template(me, { autoPay: false }),
			await template(me, { isActive: false }),
			await template(me, { nextDueDate: ba("2027-03-06") }),
		];
		expect(await sweep(NOW, [me])).toEqual(NONE);
		expect(await booked(me)).toEqual([]);
		for (const id of ids.slice(0, 3))
			expect(await dueOf(id)).toBe("2027-03-05T03:00:00.000Z");
	});

	it("skips a template with no entry rate, never booking rate 1", async () => {
		const me = await user("USD", BA);
		const id = await template(me, { currency: "CLP", amount: "9000" });
		expect(await sweep(NOW, [me])).toEqual({ ...NONE, missingRate: 1 });
		expect(await booked(me)).toEqual([]);
		expect(await dueOf(id)).toBe("2027-03-05T03:00:00.000Z");
	});

	it("skips a USD template with no home rate, shows it overdue, posts once a rate exists", async () => {
		const me = await user("UYU", "America/Montevideo");
		const due = new Date("2027-03-05T03:00:00Z"); // Montevideo midnight
		const id = await template(me, { amount: "12.99", nextDueDate: due });
		expect(await sweep(NOW, [me])).toEqual({ ...NONE, missingRate: 1 });
		expect(await booked(me)).toEqual([]);
		const row = await fixtureDb.recurringTemplate.findUniqueOrThrow({
			where: { id },
		});
		const later = new Date(due.getTime() + AUTO_POST_GRACE_MS + 60_000);
		expect(recurringItems([row], later, "America/Montevideo").length).toBe(1);
		await adminDb.exchangeRate.create({
			data: { date: due, currency: "UYU", type: "official", rate: "40" },
		});
		expect(await sweep(NOW, [me])).toEqual({ ...NONE, posted: 1 });
		expect(await booked(me)).toEqual([
			expect.objectContaining({ usd: "12.99", home: "519.6" }),
		]);
	});
});

describe("a template changed after the ids were read", () => {
	const NOW = new Date("2027-03-05T12:00:00Z");

	for (const [label, change] of [
		["auto-pay off", { autoPay: false }],
		["ask me", { amountMode: "ASK" }],
	] as const) {
		it(`does not post once set to ${label}`, async () => {
			const me = await user("USD", BA);
			const id = await template(me, {});
			const flip = () =>
				fixtureDb.recurringTemplate.update({ where: { id }, data: change });
			expect(await sweep(NOW, [me], flip)).toEqual({ ...NONE, raced: 1 });
			expect(await booked(me)).toEqual([]);
			expect(await dueOf(id)).toBe("2027-03-05T03:00:00.000Z");
		});
	}

	it("still posts through a manual confirm", async () => {
		const me = await user("USD", BA);
		const id = await template(me, { autoPay: false });
		vi.useFakeTimers({ toFake: ["Date"], now: NOW });
		await forUser(me).apply(confirmRecurringExpense, { templateId: id });
		expect(await booked(me)).toHaveLength(1);
	});
});

describe("direction, owner, events and status", () => {
	const NOW = new Date("2027-03-05T12:00:00Z");

	it("posts income as money in and spending as money out", async () => {
		const me = await user("USD", BA);
		await template(me, {
			name: "Salary",
			direction: "IN",
			nextDueDate: new Date("2027-03-05T00:00:00Z"),
		});
		await template(me, {});
		await sweep(NOW, [me]);
		expect(
			(await booked(me)).map((r) => [r.direction, r.inType]).sort(),
		).toEqual([
			["IN", "INCOME"],
			["OUT", null],
		]);
	});

	it("books each owner's row and the same event a manual confirm writes", async () => {
		const [auto, other, manual] = [
			await user("USD", BA),
			await user("USD", BA),
			await user("USD", BA),
		];
		await template(auto, {});
		await template(other, {});
		const manualId = await template(manual, {});
		expect(await sweep(NOW, [auto, other])).toEqual({ ...NONE, posted: 2 });
		await forUser(manual).apply(confirmRecurringExpense, {
			templateId: manualId,
			dueDate: ba("2027-03-05"),
		});
		for (const id of [auto, other, manual])
			expect(await booked(id)).toHaveLength(1);

		const eventOf = async (userId: string) => {
			const rows = await adminDb.apiEvent.findMany({ where: { userId } });
			expect(rows).toHaveLength(1);
			const [e] = rows;
			const ids = await fixtureDb.expense.findFirstOrThrow({
				where: { userId },
				select: { id: true, recurringTemplateId: true },
			});
			// Ids differ per user; everything else must match.
			const payload = JSON.stringify(e?.payload)
				.replaceAll(ids.id, "EXPENSE")
				.replaceAll(ids.recurringTemplateId as string, "TEMPLATE");
			return {
				type: e?.type,
				actor: e?.actorUserId === userId,
				entityType: e?.entityType,
				payload,
			};
		};
		const autoEvent = await eventOf(auto);
		expect(autoEvent).toMatchObject({
			type: "recurring.confirmed",
			actor: true,
		});
		expect(autoEvent).toEqual(await eventOf(manual));
		expect(
			await adminDb.notification.count({
				where: { userId: { in: [auto, manual] } },
			}),
		).toBe(0);
	});

	it("writes the pass's counts to its status row", async () => {
		const me = await user("USD", BA);
		await template(me, {});
		await template(me, { currency: "CLP" });
		await sweep(NOW, [me]);
		const row = await adminDb.systemStatus.findUniqueOrThrow({
			where: { key: AUTO_POST_STATUS_KEY },
		});
		expect(row.value).toEqual({
			lastRun: iso(NOW),
			...NONE,
			posted: 1,
			missingRate: 1,
		});
	});
});
