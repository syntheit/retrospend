/**
 * Home's glance and the glance.* figures on a real Postgres, by hand.
 *
 * Sofía (ARS home, fiscal month from the 1st, days in the server's zone
 * for her) this period: ARS 1,000 on day 1; USD 10 today booked at ARS
 * 1,355 (ARS 13,550, it never moves with later rates); a refund of ARS 200
 * today; her ARS 1,500 share of Martín's dinner today; ARS 500,000 salary
 * (money in, never spending). Spent = 1,000 + 13,550 - 200 + 1,500 = ARS
 * 15,850. Last period: ARS 5,000 on day 1 and ARS 7,000 on its last day
 * (ARS 12,000); ARS 9,999 the day before it started stays out.
 * People: she owes Martín ARS 1,500; Paz (not on Retrospend) owes her ARS
 * 2,000. No accounts, so net worth = 2,000 - 1,500 = ARS 500.
 */
import { dayKey, parseDateOnlyIn } from "@retrospend/domain/time-zone";
import { beforeAll, describe, expect, it } from "vitest";
import {
	getCurrentFiscalMonth,
	getFiscalMonthRange,
	shiftMonth,
} from "~/lib/fiscal-month";
import { homeRouter } from "~/server/api/routers/home";
import { createCallerFactory } from "~/server/api/trpc";
import { readFigures } from "~/server/figures/read";
import {
	seedUser,
	setupInput,
} from "~/server/services/envelope/__tests__/pg-fixture";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import { forUser } from "~/server/services/preview";
import { userTimeZone } from "~/server/services/user-time-zone";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { glance } from "./glance";

const ars = (minor: number) => ({ minor, currency: "ARS" });
const HOUR = 3_600_000;

let tz: string;
let sofia: string;
let martin: string;
let thisFirst: string;
let lastFirst: string;
let lastLast: string;
let dayIndex: number;
let lastDays: number;

function row(
	userId: string,
	day: string,
	amount: string,
	o: Partial<{
		currency: string;
		usd: string;
		dir: "IN" | "OUT";
		inType: "INCOME" | "REFUND";
		booked: string;
	}> = {},
) {
	const currency = o.currency ?? "ARS";
	return adminDb.expense.create({
		data: {
			userId,
			title: "Row",
			amount: new Prisma.Decimal(amount),
			currency,
			date: new Date(parseDateOnlyIn(day, tz).getTime() + 12 * HOUR),
			amountInUSD: new Prisma.Decimal(o.usd ?? "0"),
			exchangeRate: new Prisma.Decimal(currency === "USD" ? 1 : 1355),
			pricingSource: "MANUAL",
			direction: o.dir ?? "OUT",
			inType: o.inType ?? null,
			...(o.booked
				? {
						rateType: "blue",
						homeCurrency: "ARS",
						homeRate: "1355",
						homeAmount: o.booked,
					}
				: {}),
		},
	});
}

function share(
	payer: { type: "user" | "shadow"; id: string },
	debtor: string,
	amount: string,
	day: string,
	debtorType: "user" | "shadow" = "user",
) {
	return adminDb.sharedTransaction.create({
		data: {
			description: "Shared",
			amount,
			currency: "ARS",
			date: new Date(parseDateOnlyIn(day, tz).getTime() + 12 * HOUR),
			paidByType: payer.type,
			paidById: payer.id,
			createdByType: payer.type,
			createdById: payer.id,
			splitParticipants: {
				create: [
					{
						participantType: debtorType,
						participantId: debtor,
						shareAmount: amount,
						verificationStatus: "ACCEPTED",
					},
					{
						participantType: payer.type,
						participantId: payer.id,
						shareAmount: "0",
						verificationStatus: "ACCEPTED",
					},
				],
			},
		},
	});
}

beforeAll(async () => {
	const rateDay = new Date("2026-10-01T00:00:00.000Z");
	await adminDb.exchangeRate.upsert({
		where: {
			date_currency_type: { date: rateDay, currency: "ARS", type: "blue" },
		},
		create: { date: rateDay, currency: "ARS", type: "blue", rate: "1355" },
		update: {},
	});
	tz = await userTimeZone(null);
	const now = new Date();
	const today = dayKey(now, tz);
	const label = getCurrentFiscalMonth(now, 1, tz);
	const thisRange = getFiscalMonthRange(label, 1, tz);
	const lastRange = getFiscalMonthRange(shiftMonth(label, -1, tz), 1, tz);
	thisFirst = dayKey(thisRange.start, tz);
	lastFirst = dayKey(lastRange.start, tz);
	lastLast = dayKey(lastRange.end, tz);
	dayIndex = Number(today.slice(8));
	lastDays = Number(lastLast.slice(8));

	const s = await createTestUser();
	const m = await createTestUser();
	sofia = s.user.id;
	martin = m.user.id;
	await adminDb.user.update({
		where: { id: sofia },
		data: { homeCurrency: "ARS" },
	});
	await adminDb.user.update({
		where: { id: martin },
		data: { homeCurrency: "ARS" },
	});
	const paz = await adminDb.shadowProfile.create({
		data: { createdById: sofia, name: "Paz" },
	});

	await row(sofia, thisFirst, "1000", { usd: "0.74" });
	await row(sofia, today, "10", {
		currency: "USD",
		usd: "10",
		booked: "13550",
	});
	await row(sofia, today, "200", { usd: "0.15", dir: "IN", inType: "REFUND" });
	await row(sofia, today, "500000", {
		usd: "369",
		dir: "IN",
		inType: "INCOME",
	});
	await share({ type: "user", id: martin }, sofia, "1500", today);
	await row(sofia, lastFirst, "5000", { usd: "3.69" });
	await row(sofia, lastLast, "7000", { usd: "5.17" });
	const before = new Date(parseDateOnlyIn(lastFirst, tz).getTime() - 12 * HOUR);
	await row(sofia, dayKey(before, tz), "9999", { usd: "7.38" });
	await share({ type: "user", id: sofia }, paz.id, "2000", lastFirst, "shadow");
});

/** Last period by this period's day: its last day when it was shorter. */
const expectedLastToDate = () => (dayIndex >= lastDays ? 1_200_000 : 500_000);

describe("figure glance.spent", () => {
	it("this period's spending in the home currency: ARS 15,850", async () => {
		const r = await readFigures(sofia, ["glance.spent"]);
		expect(r.get("glance.spent")).toEqual([ars(1_585_000)]);
	});

	it("a foreign row with no home rate is unavailable and named, never 0 or 1", async () => {
		const { user } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { homeCurrency: "ISK" },
		});
		await row(user.id, dayKey(new Date(), tz), "10", {
			currency: "USD",
			usd: "10",
		});
		await expect(readFigures(user.id, ["glance.spent"])).resolves.toEqual(
			new Map([["glance.spent", null]]),
		);
		const g = await glance(adminDb, user.id, { budget: false });
		expect(g.spent.value).toBeNull();
		expect(g.pace.this).toBeNull();
		expect(g.missingRates).toEqual(["ISK"]);
	});

	it("a share in a currency with no rate at all: unavailable and named, not a crash", async () => {
		const { user } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { homeCurrency: "ARS" },
		});
		const t = await share(
			{ type: "user", id: martin },
			user.id,
			"900",
			dayKey(new Date(), tz),
		);
		await adminDb.sharedTransaction.update({
			where: { id: t.id },
			data: { currency: "ISK" },
		});
		const g = await glance(adminDb, user.id, { budget: false });
		expect(g.spent.value).toBeNull();
		expect(g.spentLast.value).toBeNull();
		expect(g.missingRates).toEqual(["ISK"]);
	});
});

describe("figure glance.spentLast", () => {
	it("last period's total: ARS 5,000 + 7,000", async () => {
		const r = await readFigures(sofia, ["glance.spentLast"]);
		expect(r.get("glance.spentLast")).toEqual([ars(1_200_000)]);
	});
});

describe("figure glance.spentLastToDate", () => {
	it("last period up to this period's day", async () => {
		const r = await readFigures(sofia, ["glance.spentLastToDate"]);
		expect(r.get("glance.spentLastToDate")).toEqual([
			ars(expectedLastToDate()),
		]);
	});
});

describe("glance()", () => {
	it("reads the same numbers the registry serves, owed both ways, net worth", async () => {
		const g = await glance(adminDb, sofia, { budget: true });
		const r = await readFigures(sofia, [
			"glance.spent",
			"glance.spentLast",
			"glance.spentLastToDate",
			"owed.owedToYou",
			"owed.youOwe",
			"netWorth",
		]);
		for (const f of [
			g.spent,
			g.spentLast,
			g.spentLastToDate,
			g.owedToYou,
			g.youOwe,
			g.netWorth,
		])
			expect([f.value], f.id).toEqual(r.get(f.id));
		expect(g.spent.value).toEqual(ars(1_585_000));
		expect(g.owedToYou.value).toEqual(ars(200_000));
		expect(g.youOwe.value).toEqual(ars(150_000));
		expect(g.netWorth.value).toEqual(ars(50_000));
		expect(g.missingRates).toEqual([]);
		// No book: the budget part is absent, not zero.
		expect(g.budget).toBeNull();
	});

	it("the pace line: day by day this period to today, the last in full", async () => {
		const g = await glance(adminDb, sofia, { budget: false });
		expect(g.period).toMatchObject({ from: thisFirst, day: dayIndex });
		expect(g.lastPeriod).toMatchObject({
			from: lastFirst,
			to: lastLast,
			days: lastDays,
		});
		const mine = g.pace.this ?? [];
		expect(mine).toHaveLength(dayIndex);
		expect(mine[0]).toBe(dayIndex === 1 ? 1_585_000 : 100_000);
		expect(mine.at(-1)).toBe(1_585_000);
		const last = g.pace.last ?? [];
		expect(last).toHaveLength(lastDays);
		expect(last[0]).toBe(500_000);
		expect(last.at(-1)).toBe(1_200_000);
		// 15,850 against 5,000 or 12,000: more than 3% ahead either way.
		expect(g.pace.fasterThanLast).toBe(true);
	});

	it("with a book: the verdict, Left to spend and Not planned yet from the envelope engine", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		const g = await glance(adminDb, s.user.id, { budget: true });
		expect(g.budget).toMatchObject({
			state: "ready",
			verdict: {
				style: "FLEX",
				lead: { kind: "LEFT_TO_SPEND", figureId: "budget.leftToSpend" },
			},
			notPlannedYet: {
				id: "budget.notPlannedYet",
				value: { minor: 100_000, currency: "USD" },
			},
		});
		const r = await readFigures(s.user.id, ["budget.leftToSpend"]);
		if (g.budget?.state !== "ready") throw new Error("budget not ready");
		expect([g.budget.leftToSpend.left]).toEqual(r.get("budget.leftToSpend"));
		const off = await glance(adminDb, s.user.id, { budget: false });
		expect(off.budget).toBeNull();
	});

	it("is served as home.glance", async () => {
		const c = createCallerFactory(homeRouter)({
			session: { user: { id: sofia, role: "USER", isActive: true } },
			db: adminDb,
			headers: new Headers(),
		} as never);
		const g = await c.glance();
		expect(g.spent).toEqual({ id: "glance.spent", value: ars(1_585_000) });
		expect(g.budget).toBeNull();
	});
});
