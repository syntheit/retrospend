/**
 * The ledger of the parity harness (E2EE P16): one user's rows in every table
 * a device syncs, in any size, deterministic from a seed. Built to cover what
 * the figures branch on: ARS rows booked at blue, at official and unbooked,
 * USD, JPY and KWD rows with their own decimals, refunds, income, drafts,
 * hidden rows, NOT_SPENDING, amortized parents and children, an INCOME
 * category, shares in every status with and without a captured rate (one in a
 * hidden project, one with a guest beside you, corrections with negative
 * shares), accounts of every kind with legs, snapshots and rate switches,
 * templates of every frequency and direction, and rows at 30 minutes either
 * side of every profile's period edges.
 *
 * Money is seeded as integer minor units turned into decimal text; the USD
 * value and the booked home leg come from the domain helpers the app books
 * with (computeAmountInUSDDec, convertDec). Ids are random UUIDs (as
 * device-ledger.ts); the values are deterministic. User rows are written
 * through fixtureDb so the sealed suite's sweep sees them sealed.
 *
 * The exchange_rate table is shared by every file of a worker's database, so
 * the rate seed adds only the rows that are not there and `dropParityRates`
 * deletes exactly the ones it added.
 */
import { randomUUID } from "node:crypto";
import {
	columnText,
	computeAmountInUSDDec,
	convertDec,
	crossRateDec,
	roundMoneyDec,
} from "@retrospend/domain/money-dec";
import { fromMinor } from "@retrospend/domain/money-minor";
import { spentRange } from "@retrospend/domain/spent";
import { resolveTimeZone } from "~/server/services/user-time-zone";
import { Prisma } from "~prisma";
import type { LedgerProfile } from "../device-ledger";
import { adminDb, createTestUser, fixtureDb } from "../pg-harness";

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

const D = (v: string | number) => new Prisma.Decimal(v);

/** The ten-line LCG of e2e/fixtures/ledger.ts, copied so the e2e fixtures stay untouched. */
export function lcg(seed: number) {
	let state = seed;
	const rnd = () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
	return {
		rnd,
		pick: <T>(items: readonly T[]): T =>
			items[Math.floor(rnd() * items.length)] as T,
		int: (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1)),
	};
}

export interface ParitySize {
	expenses: number;
	legs: number;
	shares: number;
	accounts: number;
	templates: number;
	snapshots: number;
}

/** The always-on harness: a few hundred rows, every case present. */
export const SMALL_SIZE: ParitySize = {
	expenses: 400,
	legs: 60,
	shares: 30,
	accounts: 10,
	templates: 30,
	snapshots: 20,
};

/** The perf harness. */
export const LARGE_SIZE: ParitySize = {
	expenses: 10_000,
	legs: 3_000,
	shares: 500,
	accounts: 10,
	templates: 30,
	snapshots: 200,
};

// ── Rates ────────────────────────────────────────────────────────────────────

const RATES_START = Date.UTC(2025, 0, 1);
const RATE_DAYS = 790;

/** Units per USD, by "CURRENCY:type", as exact decimal text, a function of the day index. */
const RATE_SERIES: Record<string, (day: number) => string> = {
	"ARS:blue": (i) => String(1000 + Math.floor(i * 0.8)),
	"ARS:official": (i) => String(900 + Math.floor(i * 0.3)),
	"ARS:mep": (i) => String(1050 + Math.floor(i * 0.75)),
	"JPY:official": (i) => String(140 + (i % 30)),
	"KWD:official": (i) => (0.3 + (i % 5) / 1000).toFixed(3),
};

const dayIndex = (at: Date) =>
	Math.min(
		RATE_DAYS,
		Math.max(0, Math.floor((at.getTime() - RATES_START) / DAY)),
	);

/** The rate the seed table holds for `currency` on `at`, or null when it has none of that type. USD is 1. */
export function seedRate(
	currency: string,
	type: string,
	at: Date,
): string | null {
	if (currency === "USD") return "1";
	return RATE_SERIES[`${currency}:${type}`]?.(dayIndex(at)) ?? null;
}

export interface RateSeed {
	/** The exchange_rate ids this seed added; the rest were already there. */
	ids: string[];
}

/** One row per currency and type every `stepDays`, over 2025-01-01 to 2027-02-28, skipping rows that exist. */
export async function seedParityRates(stepDays: number): Promise<RateSeed> {
	const data: Prisma.ExchangeRateCreateManyInput[] = [];
	for (let i = 0; i <= RATE_DAYS; i += stepDays)
		for (const [key, series] of Object.entries(RATE_SERIES)) {
			const [currency, type] = key.split(":") as [string, string];
			data.push({
				date: new Date(RATES_START + i * DAY),
				currency,
				type,
				rate: series(i),
			});
		}
	const added = await adminDb.exchangeRate.createManyAndReturn({
		data,
		skipDuplicates: true,
		select: { id: true },
	});
	return { ids: added.map((r) => r.id) };
}

export async function dropParityRates(seed: RateSeed): Promise<void> {
	await adminDb.exchangeRate.deleteMany({ where: { id: { in: seed.ids } } });
}

/** Rows of the history table no price reads, with rates no day ever had; `dropWildHistory` removes them. */
export async function seedWildHistory() {
	const keys = [
		["2026-10-14", "ARS", "blue", "1"],
		["2026-10-15", "ARS", "official", "99999"],
		["2026-10-15", "JPY", "official", "0.001"],
		["2026-10-15", "KWD", "official", "777"],
	].map(([date, currency, type, rate]) => ({
		date: new Date(`${date}T00:00:00Z`),
		currency: currency as string,
		type: type as string,
		rate: rate as string,
	}));
	await adminDb.exchangeRateHistory.createMany({
		data: keys,
		skipDuplicates: true,
	});
	return keys;
}

export async function dropWildHistory(
	keys: Awaited<ReturnType<typeof seedWildHistory>>,
) {
	for (const k of keys)
		await adminDb.exchangeRateHistory.deleteMany({
			where: { date: k.date, currency: k.currency, type: k.type },
		});
}

// ── The ledger ───────────────────────────────────────────────────────────────

export interface ParityLedger {
	userId: string;
	accountIds: string[];
	templateIds: string[];
	expenseIds: string[];
	/** Row counts the delta pulls must reach. */
	counts: {
		expenses: number;
		categories: number;
		templates: number;
		accounts: number;
		snapshots: number;
		legs: number;
		rateSwitches: number;
		shares: number;
	};
	/** The id of the project the user hides from reports. */
	hiddenProjectId: string;
	bobId: string;
}

export interface ParityOptions {
	seed: number;
	size: ParitySize;
	/** The first profile is the user's; the others only add rows at their period edges. */
	profile: LedgerProfile;
	/** Profiles whose period edges get rows (the user's own is always among them). */
	edgeProfiles?: readonly LedgerProfile[];
	/** The instants the figures will be read at; edges are placed around the periods of each. */
	clocks: readonly Date[];
}

type Cur = "ARS" | "USD" | "JPY" | "KWD";
const CURRENCIES: readonly Cur[] = [
	"ARS",
	"ARS",
	"ARS",
	"ARS",
	"ARS",
	"ARS",
	"USD",
	"USD",
	"JPY",
	"KWD",
];
const AMOUNT_RANGE: Record<string, [number, number]> = {
	ARS: [100, 5_000_000],
	USD: [100, 50_000],
	JPY: [100, 500_000],
	KWD: [100, 90_000],
	XQZ: [100, 90_000],
};

const SPAN_START = Date.UTC(2025, 0, 1);
const SPAN_END = Date.UTC(2027, 1, 1);

/** Type of booking an expense gets, by the home currency: ARS has blue and official, the others official. */
const bookingTypes = (home: string) =>
	home === "ARS" ? (["blue", "official"] as const) : (["official"] as const);

interface Booking {
	exchangeRate: string;
	amountInUSD: string;
	rateType: string | null;
	homeCurrency: string | null;
	homeRate: string | null;
	homeAmount: string | null;
}

/**
 * The stored money fields of a row of `amount` in `currency` on `at`: its USD
 * value at the table's rate for the day, and, when `type` is set, the home leg
 * booked at that rate type (null when the table has no such rate, as an
 * unpriced row is saved).
 */
function book(
	amount: string,
	currency: string,
	at: Date,
	home: string,
	type: string | null,
): Booking {
	const rateCur =
		seedRate(currency, type ?? "official", at) ??
		seedRate(currency, "official", at) ??
		"1";
	const base = {
		exchangeRate: columnText(rateCur, 6),
		amountInUSD: computeAmountInUSDDec(amount, currency, rateCur).toFixed(2),
	};
	const none = {
		rateType: null,
		homeCurrency: null,
		homeRate: null,
		homeAmount: null,
	};
	if (type === null) return { ...base, ...none };
	if (currency === home)
		return {
			...base,
			rateType: type,
			homeCurrency: home,
			homeRate: "1",
			homeAmount: amount,
		};
	const rateHome = seedRate(home, type, at);
	if (rateHome === null) return { ...base, ...none };
	return {
		...base,
		rateType: type,
		homeCurrency: home,
		homeRate: columnText(crossRateDec(currency, rateCur, home, rateHome), 12),
		homeAmount: roundMoneyDec(
			convertDec(amount, currency, rateCur, home, rateHome),
			home,
		).toFixed(),
	};
}

/** Decimal text of `minor` units of `currency`. */
const text = (minor: number, currency: string) =>
	fromMinor({ minor, currency });

const chunks = <T>(items: T[], size: number): T[][] => {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
	return out;
};

export async function seedParityLedger(
	options: ParityOptions,
): Promise<ParityLedger> {
	const { profile, size } = options;
	const { home } = profile;
	const { rnd, pick, int } = lcg(options.seed);
	const { user } = await createTestUser();
	const userId = user.id;
	const bobId = (await createTestUser()).user.id;
	await adminDb.user.update({
		where: { id: userId },
		data: {
			homeCurrency: home,
			timeZone: profile.timeZone,
			fiscalMonthStartDay: profile.startDay,
			defaultRateTypes: profile.defaultRateTypes ?? {},
		},
	});

	// Categories: expense ones to spread rows over, and one INCOME category.
	const categoryIds: string[] = [];
	for (const name of ["Food", "Rent", "Travel", "Fun", "Health"])
		categoryIds.push(
			(
				await fixtureDb.category.create({
					data: { name, color: "blue", userId },
				})
			).id,
		);
	const incomeCategory = (
		await fixtureDb.category.create({
			data: { name: "Salary", color: "teal", userId, kind: "INCOME" },
		})
	).id;
	const bobCategory = (
		await fixtureDb.category.create({
			data: { name: "Bob's", color: "orange", userId: bobId },
		})
	).id;

	// ── Edges: 30 minutes either side of every profile's period start and end, for each clock.
	const edgeAts: Date[] = [];
	for (const p of options.edgeProfiles ?? [profile])
		for (const clock of options.clocks) {
			const zone = resolveTimeZone(p.timeZone);
			const now = spentRange(clock, p.startDay, zone);
			const last = spentRange(
				new Date(now.start.getTime() - DAY),
				p.startDay,
				zone,
			);
			for (const r of [now, last])
				for (const edge of [r.start.getTime(), r.end.getTime()])
					for (const d of [-30 * MINUTE, -1, 0, 1, 30 * MINUTE])
						edgeAts.push(new Date(edge + d));
		}

	// ── Expenses.
	type Row = Prisma.ExpenseCreateManyInput;
	const expenses: Row[] = [];
	const children: Row[] = [];
	const add = (
		o: {
			minor: number;
			currency: string;
			at: Date;
			direction?: "OUT" | "IN";
			inType?: "INCOME" | "REFUND";
			status?: "DRAFT" | "FINALIZED";
			hidden?: boolean;
			entryKind?: "STANDARD" | "NOT_SPENDING";
			categoryId?: string | null;
			parent?: boolean;
			parentId?: string;
			booking?: string | null;
		},
		into: Row[] = expenses,
	): string => {
		const id = randomUUID();
		const amount = text(o.minor, o.currency);
		const money = book(amount, o.currency, o.at, home, o.booking ?? null);
		into.push({
			id,
			userId,
			title: `row ${expenses.length + children.length}`,
			description: rnd() < 0.2 ? "a note" : null,
			amount: D(amount),
			currency: o.currency,
			date: o.at,
			categoryId: o.categoryId ?? null,
			pricingSource: "MANUAL",
			status: o.status ?? "FINALIZED",
			direction: o.direction ?? "OUT",
			entryKind: o.entryKind ?? "STANDARD",
			inType: o.entryKind === "NOT_SPENDING" ? null : (o.inType ?? null),
			excludeFromAnalytics: o.hidden ?? false,
			isAmortizedParent: o.parent ?? false,
			isAmortizedChild: o.parentId !== undefined,
			parentId: o.parentId ?? null,
			exchangeRate: D(money.exchangeRate),
			amountInUSD: D(money.amountInUSD),
			rateType: money.rateType,
			homeCurrency: money.homeCurrency,
			homeRate: money.homeRate === null ? null : D(money.homeRate),
			homeAmount: money.homeAmount === null ? null : D(money.homeAmount),
		});
		return id;
	};
	const amountOf = (currency: string) => {
		const [lo, hi] = AMOUNT_RANGE[currency] as [number, number];
		return int(lo, hi);
	};
	const bookingOf = (currency: string) => {
		const r = rnd();
		if (currency === home) return r < 0.85 ? pick(bookingTypes(home)) : null;
		return r < 0.6 ? pick(bookingTypes(home)) : null;
	};
	const dateOf = () => new Date(SPAN_START + rnd() * (SPAN_END - SPAN_START));

	for (let i = 0; i < size.expenses; i++) {
		const currency = pick(CURRENCIES);
		const base = {
			minor: amountOf(currency),
			currency,
			at: dateOf(),
			booking: bookingOf(currency),
			categoryId: rnd() < 0.5 ? pick(categoryIds) : null,
		};
		const r = rnd();
		if (r < 0.07) add({ ...base, direction: "IN", inType: "REFUND" });
		else if (r < 0.12) add({ ...base, direction: "IN", inType: "INCOME" });
		else if (r < 0.16) add({ ...base, status: "DRAFT" });
		else if (r < 0.2) add({ ...base, hidden: true });
		else if (r < 0.24) add({ ...base, entryKind: "NOT_SPENDING" });
		else if (r < 0.27) add({ ...base, categoryId: incomeCategory });
		else if (r < 0.3) {
			const parent = add({ ...base, parent: true });
			for (let c = 0; c < 3; c++)
				add(
					{
						...base,
						minor: Math.max(1, Math.floor(base.minor / 3)),
						at: new Date(base.at.getTime() + c * 30 * DAY),
						parentId: parent,
					},
					children,
				);
		} else add(base);
	}
	// Edges: one expense of each currency at every edge instant.
	edgeAts.forEach((at, i) => {
		const currency = CURRENCIES[i % CURRENCIES.length] as string;
		add({
			minor: amountOf(currency),
			currency,
			at,
			booking: bookingOf(currency),
			direction: i % 7 === 0 ? "IN" : "OUT",
			inType: i % 7 === 0 ? (i % 2 === 0 ? "REFUND" : "INCOME") : undefined,
		});
	});
	// Rows the figures name as a currency with no rate at all.
	if (profile.withMissingRate)
		add({ minor: 1234, currency: "XQZ", at: new Date(edgeAts[0] as Date) });
	// The parent every leg of a ledger names (kept out of spending and money in).
	const legParent = add({
		minor: 100,
		currency: "ARS",
		at: new Date(SPAN_START),
		entryKind: "NOT_SPENDING",
	});
	for (const part of chunks(expenses, 1000))
		await fixtureDb.expense.createMany({ data: part });
	for (const part of chunks(children, 1000))
		await fixtureDb.expense.createMany({ data: part });

	// ── Accounts, snapshots, legs, rate switches.
	const accountSpecs: {
		type: Prisma.AssetAccountCreateManyInput["type"];
		currency: string;
		minor: number;
		rateType?: string;
		closed?: boolean;
	}[] = [
		{ type: "CASH", currency: "ARS", minor: 5_000_000 },
		{
			type: "INVESTMENT",
			currency: "USD",
			minor: 20_000,
			rateType: "official",
		},
		{ type: "CASH", currency: "JPY", minor: 100_000 },
		{ type: "CASH", currency: "USD", minor: 99_900, closed: true },
		{ type: "LIABILITY_CREDIT_CARD", currency: "ARS", minor: 2_500_000 },
		{ type: "REAL_ESTATE", currency: "USD", minor: 8_000_000 },
		{ type: "LIABILITY_LOAN", currency: "ARS", minor: 40_000_000 },
		{ type: "INVESTMENT", currency: "ARS", minor: 9_000_000, rateType: "blue" },
		{ type: "CASH", currency: "KWD", minor: 450_000 },
		{ type: "VEHICLE", currency: "USD", minor: 1_500_000 },
	];
	const accountIds: string[] = [];
	const accountRows: Prisma.AssetAccountCreateManyInput[] = [];
	for (let i = 0; i < size.accounts; i++) {
		const spec = accountSpecs[
			i % accountSpecs.length
		] as (typeof accountSpecs)[number];
		const id = randomUUID();
		accountIds.push(id);
		accountRows.push({
			id,
			userId,
			name: `account ${i}`,
			type: spec.type,
			currency: spec.currency,
			balance: D(text(spec.minor, spec.currency)),
			exchangeRateType: spec.rateType ?? null,
			closedAt: spec.closed ? new Date("2026-02-01T00:00:00Z") : null,
			createdAt: new Date("2025-01-01T00:00:00Z"),
		});
	}
	if (profile.withMissingRate) {
		const id = randomUUID();
		accountIds.push(id);
		accountRows.push({
			id,
			userId,
			name: "xqz account",
			type: "CASH",
			currency: "XQZ",
			balance: D("10"),
			createdAt: new Date("2025-01-01T00:00:00Z"),
		});
	}
	await fixtureDb.assetAccount.createMany({ data: accountRows });

	const snapshots: Prisma.AssetSnapshotCreateManyInput[] = [];
	for (let i = 0; i < size.snapshots; i++) {
		const accountId = accountIds[i % size.accounts] as string;
		const spec = accountSpecs[
			(i % size.accounts) % accountSpecs.length
		] as (typeof accountSpecs)[number];
		// One per account and month, so (account, date) stays unique.
		const date = new Date(Date.UTC(2025, Math.floor(i / size.accounts), 1));
		const balance = text(
			Math.max(0, spec.minor + int(-1000, 1000)),
			spec.currency,
		);
		snapshots.push({
			id: randomUUID(),
			accountId,
			userId,
			date,
			recordedAt: new Date(date.getTime() + 9 * 60 * MINUTE),
			balance: D(balance),
			balanceInUSD: D(
				computeAmountInUSDDec(
					balance,
					spec.currency,
					seedRate(spec.currency, spec.rateType ?? "official", date) ??
						seedRate(spec.currency, "official", date),
				).toFixed(2),
			),
			// Every third snapshot predates the currency column: it is the account's own.
			currency: i % 3 === 0 ? null : spec.currency,
			type: i % 3 === 0 ? null : spec.type,
			exchangeRateType: i % 3 === 0 ? null : (spec.rateType ?? null),
		});
	}
	await fixtureDb.assetSnapshot.createMany({ data: snapshots });

	const transferId = randomUUID();
	await fixtureDb.transfer.create({
		data: {
			id: transferId,
			userId,
			kind: "TRANSFER",
			date: new Date(SPAN_START),
			fromAmount: "1",
			fromCurrency: "ARS",
			toAmount: "1",
			toCurrency: "ARS",
		},
	});
	const parents = {
		INCOME: { expenseId: legParent },
		TRANSFER: { transferId },
		FEE: { transferId, expenseId: legParent },
		BALANCE_UPDATE: {},
	} as const;
	const SOURCES = ["INCOME", "TRANSFER", "FEE", "BALANCE_UPDATE"] as const;
	const legs: Prisma.AccountLegCreateManyInput[] = [];
	for (let i = 0; i < size.legs; i++) {
		const source = SOURCES[i % SOURCES.length] as (typeof SOURCES)[number];
		// Income and balance updates land in an account; the others may be Not tracked.
		const tracked =
			source === "INCOME" || source === "BALANCE_UPDATE" || i % 3 !== 0;
		const spec = accountSpecs[
			(i % size.accounts) % accountSpecs.length
		] as (typeof accountSpecs)[number];
		const currency = tracked ? spec.currency : pick(["ARS", "USD", "JPY"]);
		const at = new Date(SPAN_START + rnd() * (SPAN_END - SPAN_START));
		const minor = int(-200_000, 400_000);
		const amount = text(minor, currency);
		const booked = rnd() < 0.3;
		legs.push({
			id: randomUUID(),
			userId,
			accountId: tracked ? (accountIds[i % size.accounts] as string) : null,
			currency,
			amount: D(amount),
			date: at,
			source,
			...parents[source],
			createdAt: new Date(at.getTime() + 8 * 60 * MINUTE + (i % 20) * MINUTE),
			...(booked
				? {
						homeCurrency: home,
						homeAmount: D(
							currency === home
								? amount
								: roundMoneyDec(
										convertDec(
											amount,
											currency,
											seedRate(currency, "official", at),
											home,
											seedRate(home, "official", at),
										),
										home,
									).toFixed(),
						),
					}
				: {}),
		});
	}
	if (profile.withMissingRate)
		legs.push({
			id: randomUUID(),
			userId,
			accountId: accountIds[accountIds.length - 1] as string,
			currency: "XQZ",
			amount: D("10"),
			date: edgeAts[1] as Date,
			source: "INCOME",
			expenseId: legParent,
		});
	for (const part of chunks(legs, 1000))
		await fixtureDb.accountLeg.createMany({ data: part });

	const switches: Prisma.AssetRateTypeCreateManyInput[] = [];
	const switchAts = [
		"2025-06-01T00:00:00Z",
		"2025-06-01T00:00:00Z",
		"2026-03-10T00:00:00Z",
		"2026-10-14T00:00:00Z",
	];
	for (const [n, from] of switchAts.entries()) {
		switches.push({
			id: randomUUID(),
			userId,
			accountId: accountIds[1 + (n % 3)] as string,
			from: new Date(from),
			type: n % 2 === 0 ? "blue" : "official",
			previousType: n % 2 === 0 ? "official" : "blue",
			// Two switches on one day: createdAt orders them.
			createdAt: new Date(new Date(from).getTime() + (n + 1) * 60 * MINUTE),
		});
	}
	await fixtureDb.assetRateType.createMany({ data: switches });

	// ── Templates.
	const FREQ = [
		"WEEKLY",
		"BIWEEKLY",
		"MONTHLY",
		"QUARTERLY",
		"YEARLY",
	] as const;
	const templateIds: string[] = [];
	const templates: Prisma.RecurringTemplateCreateManyInput[] = [];
	const firstClock = options.clocks[0] as Date;
	for (let i = 0; i < size.templates; i++) {
		const currency = pick(CURRENCIES);
		const id = randomUUID();
		templateIds.push(id);
		templates.push({
			id,
			userId,
			name: `template ${i}`,
			amount: D(text(amountOf(currency), currency)),
			currency,
			categoryId: i % 4 === 0 ? pick(categoryIds) : null,
			frequency: FREQ[i % FREQ.length] as (typeof FREQ)[number],
			direction: i % 6 === 5 ? "IN" : "OUT",
			// One asks for its amount each time, one is paused, one is anchored to the 31st.
			amountMode: i === 3 ? "ASK" : "FIXED",
			isActive: i !== 5,
			anchorDay: i === 7 ? 31 : null,
			autoPay: false,
			nextDueDate: new Date(firstClock.getTime() + ((i % 9) - 3) * DAY),
		});
	}
	if (profile.withMissingRate) {
		const id = randomUUID();
		templateIds.push(id);
		templates.push({
			id,
			userId,
			name: "xqz template",
			amount: D("5"),
			currency: "XQZ",
			frequency: "MONTHLY",
			autoPay: false,
			nextDueDate: new Date(firstClock.getTime() + 3 * DAY),
		});
	}
	await fixtureDb.recurringTemplate.createMany({ data: templates });

	// ── Shares: Bob's (and your own) shared expenses with you in them.
	const hidden = await fixtureDb.project.create({
		data: { name: "Hidden", createdById: bobId, primaryCurrency: "ARS" },
	});
	const shown = await fixtureDb.project.create({
		data: { name: "Shown", createdById: bobId, primaryCurrency: "ARS" },
	});
	await adminDb.projectParticipant.createMany({
		data: [
			{
				projectId: hidden.id,
				participantType: "user",
				participantId: userId,
				excludeFromAnalytics: true,
			},
			{
				projectId: shown.id,
				participantType: "user",
				participantId: userId,
				excludeFromAnalytics: false,
			},
		],
	});
	const STATUSES = [
		"PENDING",
		"ACCEPTED",
		"REJECTED",
		"AUTO_ACCEPTED",
		"ACCEPTED",
	] as const;
	const SHARE_CURRENCIES = ["ARS", "USD", "JPY", "ARS", "USD"] as const;
	const txs: Prisma.SharedTransactionCreateManyInput[] = [];
	const parts: Prisma.SplitParticipantCreateManyInput[] = [];
	const shareTx = (o: {
		minor: number;
		currency: string;
		at: Date;
		status: (typeof STATUSES)[number];
		rate: boolean;
		projectId?: string;
		guest?: boolean;
		paidByYou?: boolean;
		categoryId?: string;
		correctsId?: string;
	}) => {
		const id = randomUUID();
		const mine = o.correctsId ? -Math.abs(o.minor) : o.minor;
		const others = o.guest ? Math.floor(o.minor / 2) : 0;
		const payer = o.paidByYou ? userId : bobId;
		txs.push({
			id,
			description: `shared ${txs.length}`,
			amount: D(text(Math.abs(o.minor) + others, o.currency)),
			currency: o.currency,
			date: o.at,
			exchangeRate: o.rate
				? D(columnText(seedRate(o.currency, "official", o.at) ?? "1", 6))
				: null,
			projectId: o.projectId ?? null,
			categoryId: o.categoryId ?? null,
			correctsId: o.correctsId ?? null,
			paidByType: "user",
			paidById: payer,
			createdByType: "user",
			createdById: payer,
		});
		parts.push({
			id: randomUUID(),
			transactionId: id,
			participantType: "user",
			participantId: userId,
			shareAmount: D(text(mine, o.currency)),
			verificationStatus: o.status,
		});
		if (o.paidByYou)
			parts.push({
				id: randomUUID(),
				transactionId: id,
				participantType: "user",
				participantId: bobId,
				shareAmount: D(text(Math.abs(o.minor), o.currency)),
				verificationStatus: "ACCEPTED",
			});
		if (o.guest)
			parts.push({
				id: randomUUID(),
				transactionId: id,
				participantType: "guest",
				participantId: randomUUID(),
				shareAmount: D(text(others, o.currency)),
				verificationStatus: "PENDING",
			});
		return id;
	};
	let lastShare: string | null = null;
	for (let i = 0; i < size.shares; i++) {
		const currency = SHARE_CURRENCIES[i % SHARE_CURRENCIES.length] as string;
		const id = shareTx({
			minor: amountOf(currency),
			currency,
			at:
				i < edgeAts.length / 2 && i % 2 === 0 ? (edgeAts[i] as Date) : dateOf(),
			status: STATUSES[i % STATUSES.length] as (typeof STATUSES)[number],
			rate: i % 2 === 0,
			projectId: i % 7 === 3 ? hidden.id : i % 7 === 5 ? shown.id : undefined,
			guest: i % 5 === 2,
			paidByYou: i % 6 === 4,
			categoryId:
				i % 4 === 1 ? bobCategory : i % 4 === 3 ? pick(categoryIds) : undefined,
		});
		// A correction of the share before it: only the difference, so negative for you.
		if (i % 11 === 10 && lastShare)
			shareTx({
				minor: Math.max(1, amountOf(currency) % 5000),
				currency,
				at: dateOf(),
				status: "ACCEPTED",
				rate: false,
				correctsId: lastShare,
			});
		lastShare = id;
	}
	// An unpriced share a minute and a day before each instant, so this period and the last
	// both have one whatever the zone (2027-01-01T03:30Z is 00:30 on January 1 in Buenos Aires).
	if (profile.withMissingRate)
		for (const clock of options.clocks)
			for (const back of [MINUTE, DAY])
				shareTx({
					minor: 1234,
					currency: "XQZ",
					at: new Date(clock.getTime() - back),
					status: "ACCEPTED",
					rate: false,
				});
	await fixtureDb.sharedTransaction.createMany({ data: txs });
	await adminDb.splitParticipant.createMany({ data: parts });

	return {
		userId,
		bobId,
		accountIds,
		templateIds,
		expenseIds: expenses.map((e) => e.id as string),
		hiddenProjectId: hidden.id,
		counts: {
			expenses: expenses.length + children.length,
			categories: categoryIds.length + 1,
			templates: templates.length,
			accounts: accountRows.length,
			snapshots: snapshots.length,
			legs: legs.length,
			rateSwitches: switches.length,
			shares: parts.filter((p) => p.participantId === userId).length,
		},
	};
}

/**
 * A shared expense in a currency no rate exists for, with the user in it. A
 * share is priced from the rate table (an expense carries its own USD value),
 * so this is what makes spending and Owed to you unavailable on both sides.
 * Returns its id for `dropUnpricedShare`.
 */
export async function addUnpricedShare(
	userId: string,
	bobId: string,
	at: Date,
): Promise<string> {
	const id = randomUUID();
	await fixtureDb.sharedTransaction.create({
		data: {
			id,
			description: "no rate",
			amount: D("12.34"),
			currency: "XQZ",
			date: at,
			paidByType: "user",
			paidById: bobId,
			createdByType: "user",
			createdById: bobId,
			splitParticipants: {
				create: {
					id: randomUUID(),
					participantType: "user",
					participantId: userId,
					shareAmount: D("12.34"),
					verificationStatus: "ACCEPTED",
				},
			},
		},
	});
	return id;
}

export async function dropUnpricedShare(id: string): Promise<void> {
	await fixtureDb.sharedTransaction.delete({ where: { id } });
}
