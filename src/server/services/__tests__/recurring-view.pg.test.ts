/**
 * recurring.listView on a real Postgres. Expected values by hand: ARS home,
 * 1000 ARS per USD, today 2026-10-21 in Buenos Aires.
 *   Gym 62,000 monthly + Netflix 12.99 USD (12,990) monthly
 *   + Club 30,000 weekly (x 52 / 12 = 130,000) = ARS 204,990 a month,
 *   614,970 a quarter, 2,459,880 a year. Paused and rate-less ones are out.
 */
import { fromWallTime } from "@retrospend/domain/time-zone";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listRecurringView } from "~/server/services/recurring-view.service";
import { adminDb, createTestUser } from "~/test/pg-harness";

const TZ = "America/Argentina/Buenos_Aires";
const day = (d: number, m = 10) =>
	fromWallTime({ year: 2026, month: m - 1, day: d }, TZ);
const NOW = new Date("2026-10-21T15:00:00Z");

let me: Awaited<ReturnType<typeof createTestUser>>;
let chile: Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
	me = await createTestUser();
	await adminDb.user.update({
		where: { id: me.user.id },
		data: { homeCurrency: "ARS" },
	});
	await adminDb.exchangeRate.create({
		data: { date: day(2), currency: "ARS", type: "official", rate: "1000" },
	});
	const t = (
		id: string,
		name: string,
		amount: string,
		currency: string,
		frequency: "MONTHLY" | "WEEKLY" | "YEARLY",
		next: Date,
		extra: object = {},
	) => ({
		id,
		userId: me.user.id,
		name,
		amount,
		currency,
		frequency,
		nextDueDate: next,
		autoPay: false,
		...extra,
	});
	await adminDb.recurringTemplate.createMany({
		data: [
			t("rv_gym", "Gym", "62000", "ARS", "MONTHLY", day(19)),
			t("rv_netflix", "Netflix", "12.99", "USD", "MONTHLY", day(21), {
				autoPay: true,
			}),
			t("rv_club", "Club", "30000", "ARS", "WEEKLY", day(1, 11)),
			t("rv_paused", "Paused", "1000", "ARS", "YEARLY", day(1, 12), {
				isActive: false,
			}),
			t("rv_xyz", "Token", "10", "XYZ", "MONTHLY", day(25)),
			t("rv_ask", "Luz", "5000", "ARS", "MONTHLY", day(30), {
				amountMode: "ASK",
				isActive: false,
			}),
		],
	});
	const e = (title: string, recurringTemplateId: string, date: Date) => ({
		userId: me.user.id,
		title,
		amount: "12.99",
		currency: "USD",
		amountInUSD: "12.99",
		exchangeRate: "1",
		pricingSource: "RECURRING",
		date,
		recurringTemplateId,
	});
	await adminDb.expense.createMany({
		data: [
			e("Netflix", "rv_netflix", day(15)),
			e("Netflix", "rv_netflix", day(15, 9)),
			e("Gym", "rv_gym", day(5)),
		],
	});
	// A CLP home with no CLP rate: a USD template cannot reach CLP.
	chile = await createTestUser();
	await adminDb.user.update({
		where: { id: chile.user.id },
		data: { homeCurrency: "CLP" },
	});
	await adminDb.recurringTemplate.createMany({
		data: [
			{
				...t("rv_cl_usd", "Spotify", "5", "USD", "MONTHLY", day(25)),
				userId: chile.user.id,
			},
			{
				...t("rv_cl_clp", "Agua", "5000", "CLP", "MONTHLY", day(25)),
				userId: chile.user.id,
			},
		],
	});
});

afterAll(async () => {
	await adminDb.user.deleteMany({
		where: { id: { in: [me.user.id, chile.user.id] } },
	});
	await adminDb.exchangeRate.deleteMany({
		where: { date: day(2), currency: "ARS" },
	});
});

describe("recurring.listView", () => {
	it("gives each template its due state, Money and next date", async () => {
		const v = await listRecurringView(me.db, me.user.id, TZ, NOW);
		const by = Object.fromEntries(v.items.map((i) => [i.id, i]));
		expect(v.today).toBe("2026-10-21");
		expect(by.rv_gym).toMatchObject({
			state: "overdue",
			next: "2026-10-19",
			amount: { minor: 6200000, currency: "ARS" },
			direction: "out",
		});
		expect(by.rv_gym).not.toHaveProperty("home");
		expect(by.rv_netflix).toMatchObject({
			state: "due",
			autoPay: true,
			home: { minor: 1299000, currency: "ARS" },
		});
		expect(by.rv_club).toMatchObject({
			state: "upcoming",
			frequency: "weekly",
			nextAfter: "2026-11-08",
		});
		expect(by.rv_paused?.paused).toBe(true);
		expect(by.rv_xyz?.home).toBeNull();
		expect(by.rv_gym?.amountMode).toBe("fixed");
		expect(by.rv_ask?.amountMode).toBe("ask");
	});

	it("sums the active cost per period and names currencies without a rate", async () => {
		const v = await listRecurringView(me.db, me.user.id, TZ, NOW);
		expect(v.out).toEqual({
			month: { minor: 20499000, currency: "ARS" },
			quarter: { minor: 61497000, currency: "ARS" },
			year: { minor: 245988000, currency: "ARS" },
			missingRate: ["XYZ"],
		});
		expect(v.in).toBeNull();
	});

	it("names the home currency when its own rate is missing", async () => {
		const v = await listRecurringView(chile.db, chile.user.id, TZ, NOW);
		expect(v.out).toMatchObject({
			month: { minor: 5000, currency: "CLP" },
			missingRate: ["CLP"],
		});
	});

	it("lists this month's entries logged from any template, newest first", async () => {
		const v = await listRecurringView(me.db, me.user.id, TZ, NOW);
		expect(v.logged.map((r) => [r.title, r.date])).toEqual([
			["Netflix", "2026-10-15"],
			["Gym", "2026-10-05"],
		]);
	});
});
