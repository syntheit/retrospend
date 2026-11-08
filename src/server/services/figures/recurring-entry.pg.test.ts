/**
 * Conformance of the two loaders behind the recurring, entry and Activity row
 * figures on one ledger: the SQL loaders (loadRecurringInputs, loadActivityInputs:
 * ordered queries, includes, RLS) and the device loaders
 * (recurringInputsFromRows, activityInputsFromRows over the same rows read
 * raw, through RLS as a synced device would hold them) hand the domain compute
 * the same inputs, so the figures and rows match digit for digit, in Buenos
 * Aires and in UTC. Also the figures themselves, by hand.
 *
 * "Now" is 2026-10-15 15:00 UTC, noon in Buenos Aires. Home ARS on the blue
 * rate: blue 1,400 from Sep 15 and 1,500 from Oct 5 (official 1,000 on Oct 5
 * never wins), JPY 150, KWD 0.3, EUR 0.8 from Oct 1 and 0.5 from Oct 20. The
 * pg harness empties exchange_rate before each file, so they are seeded here.
 *
 * Recurring, Ana (ARS): Netflix USD 10 monthly = ARS 15,000; Club ARS 2,000
 * weekly = 8,666.67 a month; Gym JPY 3,000 = USD 20 = ARS 30,000; Dues KWD
 * 12.345 = USD 41.15 = ARS 61,725. Out a month ARS 115,391.67 (11,539,167
 * minor), a quarter 346,175, a year 1,384,700. Salary ARS 100,000 monthly in:
 * 100,000, 300,000 and 1,200,000. Paused and anchor templates stay out.
 *
 * Activity rows, Ana (ARS, blue 1,500): see EXPECTED below, each by hand.
 */
import {
	type ActivityRowDTO,
	activityRowsFrom,
	entryAmountOf,
	entryRowFrom,
	entryShareOf,
	type RowKey,
	rowKeyFromEntryId,
} from "@retrospend/domain/activity-rows";
import {
	type ActivityStore,
	activityInputsFromRows,
} from "@retrospend/domain/activity-rows-store";
import { rateRowsByCurrency } from "@retrospend/domain/money";
import { dec } from "@retrospend/domain/precise-decimal";
import {
	type RecurringBody,
	type RecurringInputs,
	recurringAmountOf,
	recurringBodyFrom,
	recurringCostOf,
	recurringInputsFromRows,
	recurringRateCurrencies,
} from "@retrospend/domain/recurring-view";
import { homeRateOn } from "@retrospend/domain/spend-pace";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { findExchangeRate } from "~/server/exchange-rates";
import { readFigures } from "~/server/figures/read";
import {
	loadActivityInputs,
	shapeRows,
} from "~/server/services/expense-list/rows";
import {
	loadRecurringInputs,
	readRecurringBody,
} from "~/server/services/recurring-view.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";

const NOW = new Date("2026-10-15T15:00:00Z");
const BA = "America/Argentina/Buenos_Aires";
const SCL = "America/Santiago";
const D = (v: string | number) => new Prisma.Decimal(v);
const ba = (day: string) => new Date(`${day}T03:00:00.000Z`);
const noon = (day: string) => new Date(`${day}T15:00:00Z`);

beforeAll(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterAll(() => {
	vi.useRealTimers();
});

const rateDay = (day: string, currency: string, rate: string, type: string) =>
	adminDb.exchangeRate.create({
		data: { date: new Date(`${day}T00:00:00Z`), currency, type, rate },
	});

type Person = { id: string; home: string; zone: string };

async function seedUser(home: string, zone: string, name?: string) {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: home, timeZone: zone, ...(name ? { name } : {}) },
	});
	return { id: user.id, home, zone } satisfies Person;
}

beforeAll(async () => {
	await rateDay("2026-09-15", "ARS", "1400", "blue");
	await rateDay("2026-10-05", "ARS", "1500", "blue");
	await rateDay("2026-10-05", "ARS", "1000", "official");
	await rateDay("2026-10-01", "JPY", "150", "official");
	await rateDay("2026-10-01", "KWD", "0.3", "official");
	await rateDay("2026-10-01", "EUR", "0.8", "official");
	await rateDay("2026-10-20", "EUR", "0.5", "official");
});

// ── Recurring ───────────────────────────────────────────────────────────────

type Tpl = {
	id: string;
	amount: string;
	currency?: string;
	frequency?: "WEEKLY" | "MONTHLY";
	due: Date;
	anchorDay?: number;
	direction?: "OUT" | "IN";
	isActive?: boolean;
	categoryId?: string;
};

const addTemplate = (userId: string, t: Tpl) =>
	adminDb.recurringTemplate.create({
		data: {
			id: t.id,
			userId,
			name: t.id,
			amount: D(t.amount),
			currency: t.currency ?? "ARS",
			frequency: t.frequency ?? "MONTHLY",
			nextDueDate: t.due,
			anchorDay: t.anchorDay ?? null,
			direction: t.direction ?? "OUT",
			isActive: t.isActive ?? true,
			categoryId: t.categoryId ?? null,
			autoPay: false,
		},
	});

const rawTemplates = async (userId: string) =>
	(
		await adminDb.recurringTemplate.findMany({
			where: { userId },
			include: {
				category: { select: { id: true, name: true, color: true, icon: true } },
			},
		})
	).reverse();

const deviceRecurring = async (
	p: Person,
	now: Date,
): Promise<RecurringInputs> => {
	const templates = await rawTemplates(p.id);
	const rows = await adminDb.exchangeRate.findMany();
	return recurringInputsFromRows({
		home: p.home,
		templates,
		rateRows: rateRowsByCurrency(
			rows,
			recurringRateCurrencies(p.home, templates),
		),
		now,
	});
};

const normRecurring = (i: RecurringInputs) => ({
	home: i.home,
	rates: i.rates,
	templates: i.templates.map((t) => ({
		id: t.id,
		name: t.name,
		amount: dec(t.amount).toFixed(),
		currency: t.currency,
		frequency: t.frequency,
		nextDueDate: t.nextDueDate.toISOString(),
		anchorDay: t.anchorDay,
		direction: t.direction,
		isActive: t.isActive,
		autoPay: t.autoPay,
		amountMode: t.amountMode,
		category: t.category && {
			id: t.category.id,
			name: t.category.name,
			color: t.category.color,
			icon: t.category.icon,
		},
	})),
});

/** Both loaders read the same inputs and the compute gives the same body, in the saved zone and from UTC. */
async function recurringAgrees(p: Person, now = NOW) {
	const a = await userTransaction(adminDb, p.id, (tx) =>
		loadRecurringInputs(tx, p.id, now),
	);
	const b = await deviceRecurring(p, now);
	expect(normRecurring(a)).toEqual(normRecurring(b));
	const bodies: RecurringBody[] = [];
	for (const requestZone of [undefined, "UTC"]) {
		const served = await userTransaction(adminDb, p.id, (tx) =>
			readRecurringBody(tx, p.id, requestZone, now),
		);
		const { rates: _rates, ...body } = recurringBodyFrom({
			inputs: b,
			now,
			timeZone: requestZone ?? p.zone,
			stepZone: p.zone,
		});
		const { rates: _served, ...servedBody } = served;
		expect(servedBody).toEqual(body);
		bodies.push(servedBody);
	}
	return bodies[0] as RecurringBody;
}

const RECURRING_FIGURES = (["out", "in"] as const).flatMap((d) =>
	(["month", "quarter", "year"] as const).map((p) => [d, p] as const),
);

describe("recurring: the same templates through both loaders", () => {
	let ana: Person;
	let santiago: Person;
	let jpyHome: Person;
	let kwdHome: Person;
	let partial: Person;
	let rateless: Person;

	beforeAll(async () => {
		ana = await seedUser("ARS", BA);
		const groceries = await adminDb.category.create({
			data: { name: "Groceries", color: "emerald", userId: ana.id },
		});
		const next = ba("2026-11-01");
		const t = (id: string, o: Omit<Tpl, "id" | "due"> & { due?: Date }) =>
			addTemplate(ana.id, { id, due: next, ...o });
		await t("anaflix", { amount: "10", currency: "USD" });
		await t("anaclub", { amount: "2000", frequency: "WEEKLY" });
		await t("anagym", {
			amount: "3000",
			currency: "JPY",
			categoryId: groceries.id,
		});
		await t("anadues", { amount: "12.345", currency: "KWD" });
		await t("anasalary", {
			amount: "100000",
			direction: "IN",
			due: new Date("2026-10-31T00:00:00Z"),
			anchorDay: 31,
		});
		// Inactive: listed with their due dates, never in a cost.
		await t("anapaused", { amount: "9999", isActive: false });
		await t("anarent", {
			amount: "500",
			isActive: false,
			due: ba("2026-10-31"),
			anchorDay: 31,
		});
		await t("anafeb", {
			amount: "500",
			isActive: false,
			due: ba("2027-02-28"),
			anchorDay: 31,
		});
		await t("anaoverdue", {
			amount: "500",
			isActive: false,
			due: ba("2026-10-14"),
		});
		await t("anatoday", {
			amount: "500",
			isActive: false,
			due: ba("2026-10-15"),
		});

		santiago = await seedUser("ARS", SCL);
		await addTemplate(santiago.id, {
			id: "sclbefore",
			amount: "100",
			frequency: "WEEKLY",
			due: new Date("2026-08-30T04:00:00Z"),
		});
		await addTemplate(santiago.id, {
			id: "sclgap",
			amount: "100",
			frequency: "WEEKLY",
			due: new Date("2026-09-06T04:00:00Z"),
		});
		await addTemplate(santiago.id, {
			id: "sclsalary",
			amount: "100",
			direction: "IN",
			due: new Date("2026-09-30T00:00:00Z"),
			anchorDay: 31,
		});

		jpyHome = await seedUser("JPY", "Asia/Tokyo");
		await addTemplate(jpyHome.id, {
			id: "jpydues",
			amount: "12.345",
			currency: "KWD",
			due: new Date("2026-10-31T15:00:00Z"),
		});
		kwdHome = await seedUser("KWD", "Asia/Kuwait");
		await addTemplate(kwdHome.id, {
			id: "kwdusd",
			amount: "10",
			currency: "USD",
			due: new Date("2026-10-31T21:00:00Z"),
		});
		await addTemplate(kwdHome.id, {
			id: "kwdars",
			amount: "1500",
			due: new Date("2026-10-31T21:00:00Z"),
		});

		partial = await seedUser("ARS", BA);
		await addTemplate(partial.id, { id: "partok", amount: "1000", due: next });
		await addTemplate(partial.id, {
			id: "partxyz",
			amount: "10",
			currency: "XYZ",
			due: next,
		});
		rateless = await seedUser("MVR", BA);
		await addTemplate(rateless.id, {
			id: "rateusd",
			amount: "10",
			currency: "USD",
			due: next,
		});
	});

	it("Ana in Buenos Aires: the costs by hand, the due dates in her saved zone and in UTC days for income", async () => {
		const b = await recurringAgrees(ana);
		expect(b.out).toEqual({
			month: { minor: 11_539_167, currency: "ARS" },
			quarter: { minor: 34_617_500, currency: "ARS" },
			year: { minor: 138_470_000, currency: "ARS" },
			missingRate: [],
		});
		expect(b.in).toEqual({
			month: { minor: 10_000_000, currency: "ARS" },
			quarter: { minor: 30_000_000, currency: "ARS" },
			year: { minor: 120_000_000, currency: "ARS" },
			missingRate: [],
		});
		const byId = Object.fromEntries(b.items.map((i) => [i.id, i]));
		expect(byId.anagym).toMatchObject({
			amount: { minor: 3000, currency: "JPY" },
			home: { minor: 3_000_000, currency: "ARS" },
			category: { name: "Groceries", tone: 1 },
		});
		expect(byId.anadues).toMatchObject({
			amount: { minor: 12_345, currency: "KWD" },
			home: { minor: 6_172_500, currency: "ARS" },
		});
		// Day 31: Oct 31 steps to Nov 30, Feb 28 returns to Mar 31.
		expect(byId.anarent).toMatchObject({
			next: "2026-10-31",
			nextAfter: "2026-11-30",
			paidOnFrom: "2026-09-30",
			state: "upcoming",
		});
		expect(byId.anafeb).toMatchObject({
			nextAfter: "2027-03-31",
			paidOnFrom: "2027-01-31",
		});
		expect(byId.anaoverdue?.state).toBe("overdue");
		expect(byId.anatoday?.state).toBe("due");
		// Income is a UTC day: Oct 31 UTC midnight steps to Nov 30 and back to Sep 30.
		expect(byId.anasalary).toMatchObject({
			nextAfter: "2026-11-29",
			paidOnFrom: "2026-09-30",
		});
	});

	it("Santiago, where Sep 6 has no midnight: due dates land on that day and step a week on", async () => {
		const now = new Date("2026-09-01T12:00:00Z");
		const b = await recurringAgrees(santiago, now);
		const byId = Object.fromEntries(b.items.map((i) => [i.id, i]));
		expect(byId.sclbefore).toMatchObject({
			next: "2026-08-30",
			nextAfter: "2026-09-06",
			paidOnFrom: "2026-08-23",
		});
		expect(byId.sclgap).toMatchObject({
			next: "2026-09-06",
			nextAfter: "2026-09-13",
			paidOnFrom: "2026-08-30",
		});
		// Income at UTC midnight on Sep 30 shows as Sep 29 in Santiago (UTC-4) and steps UTC days.
		expect(byId.sclsalary).toMatchObject({
			next: "2026-09-29",
			paidOnFrom: "2026-08-31",
		});
	});

	it("JPY home rounds KWD 12.345 (USD 41.15 is JPY 6,172.5) half to even: 6,172", async () => {
		const b = await recurringAgrees(jpyHome);
		expect(b.items[0]?.home).toEqual({ minor: 6172, currency: "JPY" });
		expect(b.out.quarter).toEqual({ minor: 18_518, currency: "JPY" });
	});

	it("KWD home keeps fils: USD 10 is KWD 3.000 and ARS 1,500 is KWD 0.300", async () => {
		const b = await recurringAgrees(kwdHome);
		expect(b.out).toEqual({
			month: { minor: 3300, currency: "KWD" },
			quarter: { minor: 9900, currency: "KWD" },
			year: { minor: 39_600, currency: "KWD" },
			missingRate: [],
		});
	});

	it("a template with no rate, or a home currency with none, names it and leaves the cost unavailable", async () => {
		expect((await recurringAgrees(partial)).out.missingRate).toEqual(["XYZ"]);
		expect((await recurringAgrees(rateless)).out.missingRate).toEqual(["MVR"]);
	});

	it("the figures read the body the way the device does", async () => {
		for (const p of [ana, partial, rateless, jpyHome, kwdHome]) {
			const body = recurringBodyFrom({
				inputs: await deviceRecurring(p, NOW),
				now: NOW,
				timeZone: p.zone,
				stepZone: p.zone,
			});
			const ids = RECURRING_FIGURES.map(
				([d, per]) => `recurring.cost.${d}.${per}`,
			);
			const served = await readFigures(p.id, ids);
			for (const [d, per] of RECURRING_FIGURES) {
				const cost = recurringCostOf(body, d, per);
				expect(served.get(`recurring.cost.${d}.${per}`)).toEqual(
					Array.isArray(cost) ? cost : null,
				);
			}
			for (const item of body.items) {
				expect(
					(
						await readFigures(p.id, ["recurring.amount"], {
							recurringId: item.id,
						})
					).get("recurring.amount"),
				).toEqual(recurringAmountOf(body, item.id));
			}
		}
		expect(
			(await readFigures(ana.id, ["recurring.cost.out.month"])).get(
				"recurring.cost.out.month",
			),
		).toEqual([{ minor: 11_539_167, currency: "ARS" }]);
		expect(
			(await readFigures(partial.id, ["recurring.cost.out.month"])).get(
				"recurring.cost.out.month",
			),
		).toBeNull();
	});
});

// ── Activity rows and the entry figures ─────────────────────────────────────

type Exp = {
	id: string;
	amount: string;
	currency?: string;
	usd: string;
	date?: Date;
	direction?: "OUT" | "IN";
	inType?: "INCOME" | "REFUND";
	entryKind?: "STANDARD" | "NOT_SPENDING";
	hidden?: boolean;
	categoryId?: string;
	parentId?: string;
	amortizedParent?: boolean;
	booked?: { currency: string; amount: string; rate: string };
};

const addExpense = (userId: string, e: Exp) =>
	adminDb.expense.create({
		data: {
			id: e.id,
			userId,
			title: e.id,
			amount: D(e.amount),
			currency: e.currency ?? "ARS",
			date: e.date ?? noon("2026-10-08"),
			categoryId: e.categoryId ?? null,
			parentId: e.parentId ?? null,
			isAmortizedParent: e.amortizedParent ?? false,
			amountInUSD: D(e.usd),
			exchangeRate: D(1500),
			pricingSource: "MANUAL",
			direction: e.direction ?? "OUT",
			entryKind: e.entryKind ?? "STANDARD",
			inType: e.inType ?? null,
			excludeFromAnalytics: e.hidden ?? false,
			...(e.booked
				? {
						rateType: "blue",
						homeCurrency: e.booked.currency,
						homeAmount: D(e.booked.amount),
						homeRate: D(e.booked.rate),
					}
				: {}),
		},
	});

async function addShared(
	id: string,
	s: {
		amount: string;
		currency?: string;
		rate?: string;
		payer: string;
		creator?: string;
		participants: Record<string, string>;
		status?: "PENDING" | "REJECTED" | "ACCEPTED";
		projectId?: string;
		locked?: boolean;
		categoryId?: string;
		date?: Date;
	},
) {
	await adminDb.sharedTransaction.create({
		data: {
			id,
			description: id,
			amount: D(s.amount),
			currency: s.currency ?? "ARS",
			date: s.date ?? noon("2026-10-09"),
			exchangeRate: s.rate ? D(s.rate) : null,
			paidByType: "user",
			paidById: s.payer,
			createdByType: "user",
			createdById: s.creator ?? s.payer,
			isLocked: s.locked ?? false,
			projectId: s.projectId ?? null,
			categoryId: s.categoryId ?? null,
			splitParticipants: {
				create: Object.entries(s.participants).map(([who, share]) => ({
					participantType: "user" as const,
					participantId: who,
					shareAmount: D(share),
					verificationStatus: s.status ?? "ACCEPTED",
				})),
			},
		},
	});
}

const settle = (
	id: string,
	s: {
		from: string;
		to: string;
		amount: string;
		currency?: string;
		at?: string;
		group?: string;
		status?: "PROPOSED" | "FINALIZED" | "REJECTED";
		offset?: boolean;
		projectId?: string;
	},
) =>
	adminDb.settlement.create({
		data: {
			id,
			fromParticipantType: "user",
			fromParticipantId: s.from,
			toParticipantType: "user",
			toParticipantId: s.to,
			amount: D(s.amount),
			currency: s.currency ?? "ARS",
			status: s.status ?? "FINALIZED",
			initiatedAt: new Date(s.at ?? "2026-10-10T15:00:00Z"),
			paymentGroupId: s.group ?? null,
			isOffset: s.offset ?? false,
			projectId: s.projectId ?? null,
		},
	});

/** The device store as a synced device holds it: the rows RLS lets this person read, raw. */
async function storeOf(userId: string): Promise<ActivityStore> {
	const users = await adminDb.user.findMany({
		select: { id: true, name: true, avatarPath: true },
	});
	return userTransaction(adminDb, userId, async (tx) => ({
		userId,
		expenses: await tx.expense.findMany(),
		categories: await tx.category.findMany(),
		splits: await tx.splitParticipant.findMany(),
		transactions: await tx.sharedTransaction.findMany(),
		projects: await tx.project.findMany({ select: { id: true, name: true } }),
		settlements: await tx.settlement.findMany(),
		memberships: await tx.projectParticipant.findMany(),
		people: Object.fromEntries(
			users.map((u) => [
				`user:${u.id}`,
				{
					name: u.name ?? "",
					imageUrl: u.avatarPath ? `/api/images/${u.avatarPath}` : null,
				},
			]),
		),
		rateRows: await adminDb.exchangeRate.findMany(),
	}));
}

describe("activity rows: the same ledger through both loaders", () => {
	let ana: Person;
	let ben: Person;
	let cam: Person;
	let keys: RowKey[];
	let benKeys: RowKey[];
	let rows: Map<string, ActivityRowDTO>;

	const ctxOf = (
		userId: string,
		home: string,
		rate: number | null,
		timeZone?: string,
	) => ({
		userId,
		timeZone,
		rates: { home, homeRate: rate },
		defaultRateType: null,
	});
	const homeRateOf = (p: Person) =>
		userTransaction(
			adminDb,
			p.id,
			async (tx) => (await findExchangeRate(tx, p.home, NOW))?.rate ?? null,
		);

	/** Both loaders shape the same page the same way; returns the served rows by id. */
	async function bothAgree(p: Person, ks: RowKey[], zone: string | undefined) {
		const rate = await homeRateOf(p);
		const store = await storeOf(p.id);
		const deviceRate = homeRateOn(
			p.home,
			store.rateRows
				.filter((r) => r.currency === p.home)
				.map((r) => ({ date: r.date, rate: Number(r.rate), type: r.type })),
			NOW,
		);
		expect(deviceRate).toBe(rate);
		const c = ctxOf(p.id, p.home, rate, zone);
		const served = await userTransaction(adminDb, p.id, (tx) =>
			shapeRows(tx, ks, c),
		);
		const a = await userTransaction(adminDb, p.id, (tx) =>
			loadActivityInputs(tx, ks, p.id),
		);
		const b = activityInputsFromRows(store, ks);
		expect(ids(a.personal)).toEqual(ids(b.personal));
		expect(a.shares.map((s) => s.transaction.id).sort()).toEqual(
			b.shares.map((s) => s.transaction.id).sort(),
		);
		expect(a.payments.map((s) => s.id).sort()).toEqual(
			b.payments.map((s) => s.id).sort(),
		);
		expect(a.who).toEqual(b.who);
		expect(a.roles).toEqual(b.roles);
		expect(a.rateRows).toEqual(b.rateRows);
		expect(activityRowsFrom(ks, b, c)).toEqual(served);
		return new Map(served.map((r) => [r.id, r]));
	}
	const ids = (l: { id: string }[]) => l.map((r) => r.id).sort();

	beforeAll(async () => {
		ana = await seedUser("ARS", BA, "Ana Ruiz");
		ben = await seedUser("ARS", BA, "Ben Martin");
		cam = await seedUser("ARS", BA, "Cam Ortiz");
		const food = await adminDb.category.create({
			data: { name: "Food", color: "amber", userId: ana.id },
		});
		const pay = await adminDb.category.create({
			data: { name: "Pay", color: "blue", userId: ana.id, kind: "INCOME" },
		});
		const bensCat = await adminDb.category.create({
			data: { name: "Bens", color: "red", userId: ben.id },
		});
		const own = (e: Exp) => addExpense(ana.id, e);
		await own({
			id: "p_jpy",
			amount: "1234",
			currency: "JPY",
			usd: "8.23",
			categoryId: food.id,
		});
		await own({ id: "p_kwd", amount: "12.345", currency: "KWD", usd: "40.1" });
		await own({
			id: "p_booked",
			amount: "100",
			currency: "USD",
			usd: "100",
			booked: { currency: "ARS", amount: "140000", rate: "1400" },
		});
		await own({ id: "p_chf", amount: "50", currency: "CHF", usd: "55" });
		await own({
			id: "p_late",
			amount: "700",
			usd: "0.47",
			date: new Date("2026-10-31T01:30:00Z"),
		});
		await own({
			id: "p_income",
			amount: "50000",
			usd: "33.33",
			direction: "IN",
			inType: "INCOME",
		});
		await own({
			id: "p_refund",
			amount: "200",
			usd: "0.13",
			direction: "IN",
			inType: "REFUND",
		});
		await own({
			id: "p_transfer",
			amount: "300",
			usd: "0.2",
			entryKind: "NOT_SPENDING",
		});
		await own({ id: "p_hidden", amount: "400", usd: "0.27", hidden: true });
		await own({ id: "p_cat", amount: "600", usd: "0.4", categoryId: pay.id });
		await own({
			id: "p_parent",
			amount: "900",
			usd: "0.6",
			amortizedParent: true,
		});
		for (const n of [1, 2, 3])
			await own({
				id: `p_part${n}`,
				amount: "300",
				usd: "0.2",
				parentId: "p_parent",
			});
		await addExpense(ben.id, { id: "b_own", amount: "5", usd: "0.01" });

		const trip = await adminDb.project.create({
			data: { name: "Trip", primaryCurrency: "ARS", createdById: ben.id },
		});
		const house = await adminDb.project.create({
			data: { name: "House", primaryCurrency: "ARS", createdById: ben.id },
		});
		const members: [
			string,
			string,
			string,
			"ORGANIZER" | "EDITOR" | "CONTRIBUTOR",
		][] = [
			[trip.id, ben.id, "user", "ORGANIZER"],
			[trip.id, ana.id, "user", "EDITOR"],
			[trip.id, cam.id, "user", "CONTRIBUTOR"],
			[house.id, ben.id, "user", "ORGANIZER"],
			[house.id, ana.id, "user", "CONTRIBUTOR"],
		];
		for (const [projectId, participantId, participantType, role] of members)
			await adminDb.projectParticipant.create({
				data: {
					projectId,
					participantId,
					participantType: participantType as "user",
					role,
				},
			});
		const both = (a: string, b: string) => ({ [ana.id]: a, [ben.id]: b });
		await addShared("s_ars", {
			amount: "9000",
			payer: ben.id,
			participants: both("3000", "6000"),
		});
		await addShared("s_usd", {
			amount: "90",
			currency: "USD",
			rate: "1",
			payer: ben.id,
			participants: both("30", "60"),
		});
		await addShared("s_eurcap", {
			amount: "60",
			currency: "EUR",
			rate: "0.75",
			payer: ben.id,
			participants: both("20", "40"),
		});
		await addShared("s_eurlook", {
			amount: "60",
			currency: "EUR",
			payer: ben.id,
			participants: both("20", "40"),
		});
		await addShared("s_chf", {
			amount: "40",
			currency: "CHF",
			payer: ben.id,
			participants: both("10", "30"),
		});
		await addShared("s_trip", {
			amount: "1000",
			payer: ben.id,
			projectId: trip.id,
			participants: both("500", "500"),
			categoryId: bensCat.id,
		});
		await addShared("s_house", {
			amount: "1000",
			payer: ben.id,
			projectId: house.id,
			participants: both("500", "500"),
		});
		await addShared("s_mine", {
			amount: "1000",
			payer: ana.id,
			participants: both("500", "500"),
		});
		await addShared("s_locked", {
			amount: "1000",
			payer: ana.id,
			locked: true,
			participants: both("500", "500"),
		});
		await addShared("s_pending", {
			amount: "1000",
			payer: ben.id,
			status: "PENDING",
			participants: both("500", "500"),
		});
		await addShared("s_rejected", {
			amount: "1000",
			payer: ben.id,
			status: "REJECTED",
			participants: both("500", "500"),
		});
		await addShared("s_notmine", {
			amount: "1000",
			payer: ben.id,
			participants: { [ben.id]: "500", [cam.id]: "500" },
		});
		await addShared("s_late", {
			amount: "1000",
			payer: ben.id,
			date: new Date("2026-10-31T01:30:00Z"),
			participants: both("500", "500"),
		});

		const header = (id: string, amount: string, currency = "ARS") =>
			adminDb.payment.create({
				data: {
					id,
					payerType: "user",
					payerId: ben.id,
					payeeType: "user",
					payeeId: ana.id,
					amount: D(amount),
					currency,
					paidOn: new Date("2026-10-10T00:00:00Z"),
					recordedByType: "user",
					recordedById: ben.id,
					status: "FINALIZED",
				},
			});
		await settle("pay_one", { from: ben.id, to: ana.id, amount: "500" });
		await header("pay_grp", "500.30");
		await settle("pay_g1", {
			from: ben.id,
			to: ana.id,
			amount: "300.10",
			group: "pay_grp",
			projectId: trip.id,
			at: "2026-10-12T15:00:00Z",
		});
		await settle("pay_g2", {
			from: ben.id,
			to: ana.id,
			amount: "200.20",
			group: "pay_grp",
			projectId: house.id,
			status: "PROPOSED",
		});
		await settle("pay_usd", {
			from: ana.id,
			to: ben.id,
			amount: "10",
			currency: "USD",
		});
		await settle("pay_jpy", {
			from: ana.id,
			to: ben.id,
			amount: "3000",
			currency: "JPY",
		});
		await settle("pay_kwd", {
			from: ana.id,
			to: ben.id,
			amount: "12.345",
			currency: "KWD",
		});
		await settle("pay_rejected", {
			from: ben.id,
			to: ana.id,
			amount: "1",
			status: "REJECTED",
		});
		await header("pay_off", "0");
		await settle("pay_offset", {
			from: ben.id,
			to: ana.id,
			amount: "9",
			group: "pay_off",
			offset: true,
		});
		await settle("pay_between", {
			from: ben.id,
			to: cam.id,
			amount: "700",
			projectId: trip.id,
		});

		keys = [
			...(
				await adminDb.expense.findMany({
					where: { userId: ana.id },
					select: { id: true },
				})
			).map((e) => rowKeyFromEntryId(e.id)),
			...(
				await adminDb.sharedTransaction.findMany({ select: { id: true } })
			).map((t) => rowKeyFromEntryId(`shared:${t.id}`)),
			...[
				"pay_one|ARS",
				"pay_grp|ARS",
				"pay_usd|USD",
				"pay_jpy|JPY",
				"pay_kwd|KWD",
				"pay_rejected|ARS",
				"pay_offset|ARS",
				"pay_between|ARS",
				"nope|ARS",
			].map((k) => rowKeyFromEntryId(`payment:${k}`)),
			rowKeyFromEntryId("b_own"),
		];
		benKeys = [
			...["s_ars", "s_trip", "s_notmine", "s_mine"].map((id) =>
				rowKeyFromEntryId(`shared:${id}`),
			),
			...["pay_one|ARS", "pay_usd|USD", "pay_between|ARS"].map((k) =>
				rowKeyFromEntryId(`payment:${k}`),
			),
			rowKeyFromEntryId("b_own"),
		];
		rows = await bothAgree(ana, keys, BA);
	});

	it("both loaders agree on Ana's page in Buenos Aires and in UTC, and on Ben's", async () => {
		await bothAgree(ana, keys, "UTC");
		await bothAgree(ben, benKeys, BA);
		await bothAgree(ben, benKeys, "UTC");
	});

	it("shows only what is hers: not Ben's expense, a split she is not on, a payment between others, a rejected one or an offset", () => {
		for (const gone of [
			"b_own",
			"shared:s_notmine",
			"payment:pay_between|ARS",
			"payment:pay_rejected|ARS",
			"payment:pay_offset|ARS",
			"payment:nope|ARS",
		])
			expect(rows.has(gone)).toBe(false);
	});

	it("personal rows by hand: JPY 0 and KWD 3 decimals, a booked value that never moves, a stored USD value at the blue rate", () => {
		const r = (id: string) => rows.get(id);
		expect(r("p_jpy")).toMatchObject({
			amount: { minor: 1234, currency: "JPY" },
			home: { minor: 1_234_500, currency: "ARS" },
			category: { name: "Food", tone: 3 },
		});
		expect(r("p_kwd")).toMatchObject({
			amount: { minor: 12_345, currency: "KWD" },
			home: { minor: 6_015_000, currency: "ARS" },
		});
		expect(r("p_booked")).toMatchObject({
			home: { minor: 14_000_000, currency: "ARS" },
			rateType: "blue",
			rate: "1400",
		});
		expect(r("p_chf")).toMatchObject({
			amount: { minor: 5000, currency: "CHF" },
			home: { minor: 8_250_000, currency: "ARS" },
		});
		expect(r("p_late")?.date).toBe("2026-10-30");
		expect(r("p_parent")?.spread).toEqual({ months: 3 });
		expect(r("p_hidden")?.notCounted).toBe(true);
		expect(r("p_cat")?.notCounted).toBe(true);
		expect(r("p_income")?.kind).toBe("income");
		expect(r("p_refund")?.kind).toBe("refund");
		expect(r("p_transfer")?.kind).toBe("transfer");
	});

	it("shared rows by hand: captured rate first, else the rate at the expense's date, none shows no home", () => {
		const r = (id: string) => rows.get(`shared:${id}`);
		expect(r("s_ars")).toMatchObject({
			amount: { minor: 900_000, currency: "ARS" },
			share: { minor: 300_000, currency: "ARS" },
			payerName: "Ben",
		});
		// USD 90 at 1,500 = ARS 135,000; her USD 30 = 45,000.
		expect(r("s_usd")).toMatchObject({
			home: { minor: 13_500_000, currency: "ARS" },
			share: { minor: 4_500_000, currency: "ARS" },
		});
		// EUR 60 at the captured 0.75 per USD = USD 80 = ARS 120,000; her EUR 20 = ARS 40,000.
		expect(r("s_eurcap")).toMatchObject({
			home: { minor: 12_000_000, currency: "ARS" },
			share: { minor: 4_000_000, currency: "ARS" },
		});
		// Looked up at Oct 9: EUR 0.8 (the Oct 20 row is later): USD 75 = ARS 112,500; her EUR 20 = ARS 37,500.
		expect(r("s_eurlook")).toMatchObject({
			home: { minor: 11_250_000, currency: "ARS" },
			share: { minor: 3_750_000, currency: "ARS" },
		});
		// CHF has no rate at all: no home, her share stays CHF 10.00.
		expect(r("s_chf")).toMatchObject({
			home: null,
			sortKey: null,
			share: { minor: 1000, currency: "CHF" },
		});
	});

	it("shared rows by hand: who may edit, who is waiting, and which category shows", () => {
		const r = (id: string) => rows.get(`shared:${id}`);
		expect(r("s_trip")?.canEdit).toBe(true);
		expect(r("s_house")?.canEdit).toBe(false);
		expect(r("s_mine")?.canEdit).toBe(true);
		expect(r("s_locked")?.canEdit).toBe(false);
		expect(r("s_pending")?.waiting).toBe("review");
		expect(r("s_rejected")?.waiting).toBe("rejected");
		expect(r("s_trip")?.category).toBeNull();
		expect(r("s_trip")?.project).toMatchObject({ name: "Trip" });
		expect(r("s_late")?.date).toBe("2026-10-30");
	});

	it("payments by hand: a group sums exactly, foreign ones price at their date, a currency with no rate has no home", () => {
		const r = (key: string) => rows.get(`payment:${key}`);
		// 300.10 + 200.20 = 500.30 across two projects: no single project, pending while one is proposed.
		expect(r("pay_grp|ARS")).toMatchObject({
			amount: { minor: 50_030, currency: "ARS" },
			project: null,
			pending: true,
			date: "2026-10-10",
			payment: { direction: "received", counterparty: "Ben" },
		});
		expect(r("pay_one|ARS")).toMatchObject({
			amount: { minor: 50_000, currency: "ARS" },
		});
		expect(r("pay_usd|USD")).toMatchObject({
			home: { minor: 1_500_000, currency: "ARS" },
			payment: { direction: "sent", counterparty: "Ben" },
		});
		expect(r("pay_jpy|JPY")).toMatchObject({
			amount: { minor: 3000, currency: "JPY" },
			home: { minor: 3_000_000, currency: "ARS" },
		});
		expect(r("pay_kwd|KWD")).toMatchObject({
			amount: { minor: 12_345, currency: "KWD" },
			home: { minor: 6_172_500, currency: "ARS" },
		});
	});

	it("the entry figures read the row the way the device does", async () => {
		const store = await storeOf(ana.id);
		const c = ctxOf(ana.id, "ARS", 1500, undefined);
		const entries = [...rows.values()].map((r) => r.id);
		for (const id of [...entries, "nope", "shared:nope", "payment:nope|ARS"]) {
			const row = entryRowFrom(
				id,
				activityInputsFromRows(store, [rowKeyFromEntryId(id)]),
				c,
			);
			const served = await readFigures(
				ana.id,
				["entry.amount", "entry.share"],
				{ entryId: id },
			);
			expect(served.get("entry.amount")).toEqual(entryAmountOf(row));
			expect(served.get("entry.share")).toEqual(entryShareOf(row));
		}
		expect(
			(
				await readFigures(ana.id, ["entry.share"], { entryId: "shared:s_ars" })
			).get("entry.share"),
		).toEqual([{ minor: 300_000, currency: "ARS" }]);
	});
});

describe("activity rows in other home currencies", () => {
	it("JPY home rounds half to even and KWD home keeps fils, the same through both loaders", async () => {
		const jpy = await seedUser("JPY", "Asia/Tokyo");
		const kwd = await seedUser("KWD", "Asia/Kuwait");
		// USD 10 is JPY 1,500; KWD 12.345 stored as USD 41.15 is JPY 6,172.5, so 6,172.
		await addExpense(jpy.id, {
			id: "j_usd",
			amount: "10",
			currency: "USD",
			usd: "10",
		});
		await addExpense(jpy.id, {
			id: "j_kwd",
			amount: "12.345",
			currency: "KWD",
			usd: "41.15",
		});
		// USD 10 is KWD 3.000; ARS 1,500 stored as USD 1 is KWD 0.300.
		await addExpense(kwd.id, {
			id: "k_usd",
			amount: "10",
			currency: "USD",
			usd: "10",
		});
		await addExpense(kwd.id, { id: "k_ars", amount: "1500", usd: "1" });
		for (const [p, ids, expected] of [
			[jpy, ["j_usd", "j_kwd"], [1500, 6172]],
			[kwd, ["k_usd", "k_ars"], [3000, 300]],
		] as const) {
			const keys = ids.map((id) => rowKeyFromEntryId(id));
			const rate = await userTransaction(
				adminDb,
				p.id,
				async (tx) => (await findExchangeRate(tx, p.home, NOW))?.rate ?? null,
			);
			const c = {
				userId: p.id,
				timeZone: p.zone,
				rates: { home: p.home, homeRate: rate },
			};
			const served = await userTransaction(adminDb, p.id, (tx) =>
				shapeRows(tx, keys, c),
			);
			expect(served.map((r) => r.home?.minor)).toEqual(expected);
			expect(
				activityRowsFrom(
					keys,
					activityInputsFromRows(await storeOf(p.id), keys),
					c,
				),
			).toEqual(served);
		}
	});

	it("with no home rate a foreign row has no home value, and a row in the home currency needs none", async () => {
		const mvr = await seedUser("MVR", BA);
		await addExpense(mvr.id, {
			id: "m_usd",
			amount: "10",
			currency: "USD",
			usd: "10",
		});
		await addExpense(mvr.id, {
			id: "m_own",
			amount: "50",
			currency: "MVR",
			usd: "3",
		});
		const keys = ["m_usd", "m_own"].map((id) => rowKeyFromEntryId(id));
		const c = {
			userId: mvr.id,
			timeZone: BA,
			rates: { home: "MVR", homeRate: null },
		};
		const served = await userTransaction(adminDb, mvr.id, (tx) =>
			shapeRows(tx, keys, c),
		);
		expect(served[0]?.home).toBeNull();
		expect(served[1] && "home" in served[1]).toBe(false);
		expect(served[1]?.sortKey).toBe(5000);
		expect(
			activityRowsFrom(
				keys,
				activityInputsFromRows(await storeOf(mvr.id), keys),
				c,
			),
		).toEqual(served);
	});
});
