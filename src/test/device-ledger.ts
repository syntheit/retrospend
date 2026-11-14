/**
 * A ledger for the device conformance tests: one user with spending, shares,
 * accounts, legs, templates and rate type switches, placed relative to the
 * user's own fiscal month so that every profile (home currency, zone, start
 * day) has rows inside the month, last month, and on both sides of each edge.
 * The rate table is global and seeded once by `seedRates`.
 */
import { randomUUID } from "node:crypto";
import { spentRange } from "@retrospend/domain/spent";
import { resolveTimeZone } from "~/server/services/user-time-zone";
import { Prisma } from "~prisma";
import { adminDb, createTestUser, fixtureDb } from "./pg-harness";

const D = (v: string | number) => new Prisma.Decimal(v);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export interface LedgerProfile {
	home: string;
	/** The stored zone; null or unsupported falls back to DEFAULT_TIME_ZONE. */
	timeZone: string | null;
	startDay: number;
	defaultRateTypes?: Record<string, string>;
	/** Adds an XQZ share, account and template: a currency with no rate at all. */
	withMissingRate?: boolean;
}

export interface Ledger {
	userId: string;
	accountIds: string[];
	templateIds: string[];
}

/** Units per USD: ARS blue 1,400 then 1,500 and official 1,000, JPY 150, KWD 0.3. */
export async function seedRates() {
	const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
	await adminDb.exchangeRate.createMany({
		data: [
			["2026-09-15", "ARS", "blue", "1400"],
			["2026-10-05", "ARS", "blue", "1500"],
			["2026-10-05", "ARS", "official", "1000"],
			["2026-10-01", "JPY", "official", "150"],
			["2026-10-01", "KWD", "official", "0.3"],
		].map(([date, currency, type, rate]) => ({
			date: day(date as string),
			currency: currency as string,
			type: type as string,
			rate: rate as string,
		})),
	});
}

export async function seedLedger(
	profile: LedgerProfile,
	now: Date,
): Promise<Ledger> {
	const { user } = await createTestUser();
	const userId = user.id;
	const { user: bob } = await createTestUser();
	const { home } = profile;
	await adminDb.user.update({
		where: { id: userId },
		data: {
			homeCurrency: home,
			timeZone: profile.timeZone,
			fiscalMonthStartDay: profile.startDay,
			defaultRateTypes: profile.defaultRateTypes ?? {},
		},
	});
	// The month the figures read, in the zone the server resolves for this user.
	const month = spentRange(
		now,
		profile.startDay,
		resolveTimeZone(profile.timeZone),
	);
	const inMonth = (days: number) =>
		new Date(month.start.getTime() + days * DAY + 12 * 60 * MINUTE);
	const before = (days: number) => new Date(month.start.getTime() - days * DAY);

	const expense = (e: {
		amount: string;
		usd: string;
		at: Date;
		currency?: string;
		direction?: "OUT" | "IN";
		inType?: "INCOME" | "REFUND";
		status?: "DRAFT" | "FINALIZED";
		hidden?: boolean;
		categoryId?: string;
		bookedAt?: { currency: string; amount: string };
	}) => {
		const currency = e.currency ?? "ARS";
		// A row in the home currency is booked as entered, as saving it does.
		const booked =
			e.bookedAt ??
			(currency === home ? { currency, amount: e.amount } : undefined);
		return fixtureDb.expense.create({
			data: {
				id: randomUUID(),
				userId,
				title: "row",
				amount: D(e.amount),
				currency,
				date: e.at,
				categoryId: e.categoryId ?? null,
				amountInUSD: D(e.usd),
				exchangeRate: D(1500),
				pricingSource: "MANUAL",
				status: e.status ?? "FINALIZED",
				direction: e.direction ?? "OUT",
				inType: e.inType ?? null,
				excludeFromAnalytics: e.hidden ?? false,
				...(booked
					? {
							rateType: "blue",
							homeCurrency: booked.currency,
							homeAmount: D(booked.amount),
							homeRate: D(1400),
						}
					: {}),
			},
		});
	};
	const salary = await fixtureDb.category.create({
		data: { name: "Salary", color: "blue", userId, kind: "INCOME" },
	});
	// This month, and each side of its edges: 23:30 local on its last day is in,
	// one minute past it is next month's, 23:59 the day before its start is last month's.
	await expense({ amount: "30000.50", usd: "20", at: inMonth(1) });
	await expense({ amount: "10", usd: "10", at: inMonth(2), currency: "USD" });
	await expense({ amount: "3000", usd: "20", at: inMonth(3), currency: "JPY" });
	await expense({
		amount: "3",
		usd: "10",
		at: new Date(inMonth(3).getTime() + 4 * 60 * MINUTE),
		currency: "KWD",
	});
	await expense({
		amount: "100",
		usd: "100",
		at: inMonth(4),
		currency: "USD",
		bookedAt: { currency: "ARS", amount: "140000" },
	});
	await expense({
		amount: "200",
		usd: "0.13",
		at: inMonth(2),
		direction: "IN",
		inType: "REFUND",
	});
	await expense({
		amount: "2000",
		usd: "1.33",
		at: inMonth(1),
		direction: "IN",
		inType: "INCOME",
	});
	await expense({
		amount: "100",
		usd: "100",
		at: inMonth(2),
		currency: "USD",
		direction: "IN",
		inType: "INCOME",
	});
	await expense({ amount: "500", usd: "0.33", at: inMonth(5), hidden: true });
	await expense({
		amount: "999",
		usd: "0.66",
		at: inMonth(5),
		categoryId: salary.id,
	});
	await expense({
		amount: "888",
		usd: "0.59",
		at: inMonth(5),
		status: "DRAFT",
	});
	await expense({
		amount: "100",
		usd: "0.07",
		at: new Date(month.end.getTime() - 29 * MINUTE),
	});
	await expense({
		amount: "7",
		usd: "0.005",
		at: new Date(month.end.getTime() + MINUTE),
	});
	await expense({
		amount: "5",
		usd: "0.003",
		at: new Date(month.start.getTime() - MINUTE),
	});
	await expense({ amount: "2000", usd: "1.4", at: before(20) });
	await expense({ amount: "4", usd: "4", at: before(10), currency: "USD" });
	await expense({
		amount: "100",
		usd: "0.07",
		at: before(5),
		direction: "IN",
		inType: "REFUND",
	});

	const share = async (s: {
		amount: string;
		at: Date;
		currency?: string;
		rate?: string;
		status?: "PENDING" | "ACCEPTED" | "REJECTED";
		projectId?: string;
	}) =>
		adminDb.sharedTransaction.create({
			data: {
				id: randomUUID(),
				description: "dinner",
				amount: D(s.amount),
				currency: s.currency ?? "ARS",
				date: s.at,
				exchangeRate: s.rate ? D(s.rate) : null,
				projectId: s.projectId ?? null,
				paidByType: "user",
				paidById: bob.id,
				createdByType: "user",
				createdById: bob.id,
				splitParticipants: {
					create: {
						participantType: "user",
						participantId: userId,
						shareAmount: D(s.amount),
						verificationStatus: s.status ?? "PENDING",
					},
				},
			},
		});
	const hidden = await adminDb.project.create({
		data: { name: "Hidden", createdById: bob.id, primaryCurrency: "ARS" },
	});
	await adminDb.projectParticipant.create({
		data: {
			projectId: hidden.id,
			participantType: "user",
			participantId: userId,
			excludeFromAnalytics: true,
		},
	});
	await share({ amount: "3000", at: inMonth(6), rate: "1500" });
	await share({
		amount: "20",
		at: inMonth(6),
		currency: "USD",
		status: "ACCEPTED",
	});
	// No captured rate: priced from the table on the share's own date.
	await share({ amount: "1500", at: inMonth(3), currency: "JPY" });
	await share({ amount: "777", at: inMonth(6), status: "REJECTED" });
	await share({ amount: "888", at: inMonth(6), projectId: hidden.id });
	await share({ amount: "1000", at: before(3), rate: "1400" });

	const accountIds: string[] = [];
	const account = async (a: {
		type: Prisma.AssetAccountCreateInput["type"];
		currency: string;
		balance: string;
		rateType?: string;
		closedAt?: Date;
	}) => {
		const id = randomUUID();
		accountIds.push(id);
		await fixtureDb.assetAccount.create({
			data: {
				id,
				userId,
				name: "account",
				type: a.type,
				currency: a.currency,
				balance: D(a.balance),
				exchangeRateType: a.rateType ?? null,
				closedAt: a.closedAt ?? null,
				createdAt: new Date("2026-01-01T00:00:00Z"),
			},
		});
		return id;
	};
	const cash = await account({
		type: "CASH",
		currency: "ARS",
		balance: "50000",
	});
	const wise = await account({
		type: "INVESTMENT",
		currency: "USD",
		balance: "200",
		rateType: "official",
	});
	await account({ type: "CASH", currency: "JPY", balance: "100000" });
	await account({
		type: "CASH",
		currency: "USD",
		balance: "999",
		closedAt: new Date("2026-02-01T00:00:00Z"),
	});
	await account({
		type: "LIABILITY_CREDIT_CARD",
		currency: "ARS",
		balance: "25000",
	});
	for (const id of [cash, wise])
		await adminDb.assetSnapshot.create({
			data: {
				accountId: id,
				userId,
				date: new Date("2026-01-01T00:00:00Z"),
				recordedAt: new Date("2026-01-01T00:00:00Z"),
				balance: D(id === cash ? "50000" : "200"),
				balanceInUSD: D("1"),
				currency: id === cash ? "ARS" : "USD",
				type: id === cash ? "CASH" : "INVESTMENT",
			},
		});
	// A leg names the transfer and the expense that made it (account_leg_source_check).
	const parentTransfer = await fixtureDb.transfer.create({
		data: {
			userId,
			kind: "TRANSFER",
			date: new Date("2026-01-01T00:00:00Z"),
			fromAmount: "1",
			fromCurrency: "ARS",
			toAmount: "1",
			toCurrency: "ARS",
		},
	});
	// Kept out of spending and money in, so it only parents legs.
	const parentExpense = await fixtureDb.expense.create({
		data: {
			userId,
			title: "parent",
			amount: "1",
			currency: "ARS",
			date: new Date("2026-01-01T00:00:00Z"),
			amountInUSD: "1",
			exchangeRate: "1",
			pricingSource: "test",
			entryKind: "NOT_SPENDING",
		},
	});
	const parents = {
		INCOME: { expenseId: parentExpense.id },
		TRANSFER: { transferId: parentTransfer.id },
		FEE: { transferId: parentTransfer.id, expenseId: parentExpense.id },
	};
	const leg = (l: {
		accountId: string | null;
		amount: string;
		currency: string;
		at: Date;
		source: "INCOME" | "TRANSFER" | "FEE";
		homeAmount?: string;
	}) =>
		adminDb.accountLeg.create({
			data: {
				userId,
				accountId: l.accountId,
				currency: l.currency,
				amount: D(l.amount),
				date: l.at,
				source: l.source,
				...parents[l.source],
				createdAt: new Date(l.at.getTime() + 8 * 60 * MINUTE),
				...(l.homeAmount
					? { homeAmount: D(l.homeAmount), homeCurrency: home }
					: {}),
			},
		});
	await leg({
		accountId: cash,
		amount: "1000",
		currency: "ARS",
		at: inMonth(2),
		source: "INCOME",
		...(home === "ARS" ? { homeAmount: "1000" } : {}),
	});
	await leg({
		accountId: cash,
		amount: "-300",
		currency: "ARS",
		at: inMonth(3),
		source: "FEE",
	});
	await leg({
		accountId: wise,
		amount: "50",
		currency: "USD",
		at: inMonth(4),
		source: "TRANSFER",
	});
	await leg({
		accountId: null,
		amount: "50",
		currency: "USD",
		at: inMonth(4),
		source: "TRANSFER",
	});
	await leg({
		accountId: null,
		amount: "-1500.50",
		currency: "ARS",
		at: before(60),
		source: "FEE",
	});
	await adminDb.assetRateType.create({
		data: {
			userId,
			accountId: wise,
			from: inMonth(1),
			type: "blue",
			previousType: "official",
		},
	});

	const templateIds: string[] = [];
	const template = async (t: {
		amount: string;
		currency: string;
		frequency: "WEEKLY" | "MONTHLY" | "YEARLY";
		direction?: "OUT" | "IN";
		isActive?: boolean;
	}) => {
		const id = randomUUID();
		templateIds.push(id);
		await fixtureDb.recurringTemplate.create({
			data: {
				id,
				userId,
				name: "template",
				amount: D(t.amount),
				currency: t.currency,
				frequency: t.frequency,
				direction: t.direction ?? "OUT",
				isActive: t.isActive ?? true,
				nextDueDate: new Date(now.getTime() + 3 * DAY),
				autoPay: false,
			},
		});
	};
	await template({ amount: "300000", currency: "ARS", frequency: "MONTHLY" });
	await template({ amount: "10", currency: "USD", frequency: "MONTHLY" });
	await template({
		amount: "500000",
		currency: "ARS",
		frequency: "MONTHLY",
		direction: "IN",
	});
	await template({
		amount: "1000",
		currency: "JPY",
		frequency: "WEEKLY",
		isActive: false,
	});
	await template({ amount: "24", currency: "KWD", frequency: "YEARLY" });

	if (profile.withMissingRate) {
		await share({ amount: "12.34", at: inMonth(7), currency: "XQZ" });
		const xqz = await account({
			type: "CASH",
			currency: "XQZ",
			balance: "10",
		});
		await leg({
			accountId: xqz,
			amount: "10",
			currency: "XQZ",
			at: inMonth(8),
			source: "INCOME",
		});
		await template({ amount: "5", currency: "XQZ", frequency: "MONTHLY" });
	}
	return { userId, accountIds, templateIds };
}
