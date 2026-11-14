/**
 * A budget book for a conformance ledger (E2EE P13b): the device registry's
 * budget figures are held to the server's on a book that has real closes, so
 * every profile of device-ledger.ts gets one, set up in the past and read once
 * at `now`, which closes the months before it (and writes their checkpoints).
 *
 * The book starts about three months before `now`, in the user's home currency
 * and the zone the server resolves for the user, in the style the caller names
 * (the profiles take one each, so every style's own figure is read on some
 * profile). Rows sit in the three months before `now`: ordinary spending in
 * Rent and Dining (the months before `now` and the one it is in), a USD row with no booked value (frozen at first sight), a
 * row booked at save, a refund, income every month (typical income), money
 * assigned every month, and a Wealth move. They are the user's own rows, so
 * the ledger's other rows (its spending, its shares, its card) count as well.
 */
import { randomUUID } from "node:crypto";
import { budgetMonthOf, isoDateIn } from "@retrospend/domain/envelope/months";
import { spentRange } from "@retrospend/domain/spent";
import { vi } from "vitest";
import type { SetupInput } from "~/lib/schemas/envelope";
import { getMonth } from "~/server/services/envelope/read.service";
import { setupEnvelopeBook } from "~/server/services/envelope/setup.mutation";
import { forUser } from "~/server/services/preview";
import { resolveTimeZone } from "~/server/services/user-time-zone";
import { Prisma } from "~prisma";
import type { LedgerProfile } from "./device-ledger";
import { adminDb, fixtureDb } from "./pg-harness";

const DAY = 24 * 60 * 60_000;
const D = (v: string | number) => new Prisma.Decimal(v);

export interface SeededBook {
	bookId: string;
	/** Envelope ids by name. */
	envelopes: Record<string, string>;
	/** The user's Rent and Dining categories. */
	rent: string;
	dining: string;
}

function setupOf(
	categories: { rent: string; dining: string },
	style: SetupInput["style"],
): SetupInput {
	const percent = style === "FIFTY_THIRTY_TWENTY";
	const pct = (basisPoints: number) =>
		percent
			? { target: { kind: "PERCENT_OF_INCOME" as const, basisPoints } }
			: {};
	const weekly = style === "WEEKLY";
	return {
		style,
		weekStartDay: 1,
		groups: [
			{ key: "bills", name: "Bills", role: "BILLS", ...pct(5000) },
			{ key: "spending", name: "Spending", role: "SPENDING", ...pct(3000) },
			...(percent
				? [
						{
							key: "savings",
							name: "Savings",
							role: "SAVINGS" as const,
							...pct(2000),
						},
					]
				: []),
		],
		envelopes: [
			{
				key: "rent",
				name: "Rent",
				groupKey: "bills",
				kind: "MONTHLY",
				isDefault: false,
				categoryIds: [categories.rent],
				target: {
					kind: "MONTHLY",
					amountMinor: 50_000,
					mode: "SET_ASIDE",
					cadence: "MONTH",
				},
			},
			{
				key: "dining",
				name: "Dining",
				groupKey: "spending",
				kind: "MONTHLY",
				isDefault: false,
				categoryIds: [categories.dining],
				target: {
					kind: "MONTHLY",
					amountMinor: 20_000,
					mode: "REFILL",
					cadence: weekly ? "WEEK" : "MONTH",
				},
			},
			{
				key: "spending",
				name: "Spending",
				groupKey: "spending",
				kind: "MONTHLY",
				isDefault: true,
				categoryIds: [],
			},
		],
	};
}

/** An expense of the user's at `at`; foreign rows carry a USD value, home rows may be booked at save. */
function row(
	userId: string,
	home: string,
	o: {
		at: Date;
		amount: string;
		currency?: string;
		usd: string;
		categoryId?: string | null;
		direction?: "IN" | "OUT";
		inType?: "INCOME" | "REFUND";
		booked?: boolean;
	},
) {
	const currency = o.currency ?? home;
	return fixtureDb.expense.create({
		data: {
			id: randomUUID(),
			userId,
			title: "Budget row",
			amount: D(o.amount),
			currency,
			date: o.at,
			categoryId: o.categoryId ?? null,
			amountInUSD: D(o.usd),
			exchangeRate: D(1500),
			pricingSource: "MANUAL",
			direction: o.direction ?? "OUT",
			entryKind: "STANDARD",
			inType: o.inType ?? null,
			...(o.booked
				? {
						rateType: "blue",
						homeCurrency: home,
						homeAmount: D(o.amount),
						homeRate: D(1),
					}
				: {}),
		},
	});
}

/**
 * Sets a book up about 100 days before `now`, fills three months, and reads it
 * once at `now` so the months before it close. Leaves the clock at `now`.
 */
export async function seedBudgetBook(
	userId: string,
	profile: LedgerProfile,
	now: Date,
	style: SetupInput["style"],
): Promise<SeededBook> {
	const category = (name: string) =>
		fixtureDb.category
			.create({ data: { name, color: "blue", userId } })
			.then((c) => c.id);
	const rent = await category("Rent");
	const dining = await category("Dining");
	const zone = resolveTimeZone(profile.timeZone);
	vi.setSystemTime(new Date(now.getTime() - 100 * DAY));
	await forUser(userId).apply(setupEnvelopeBook, {
		...setupOf({ rent, dining }, style),
		currency: profile.home,
		timeZone: zone,
	});
	vi.setSystemTime(now);
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: userId },
		include: { envelopes: true, periods: true },
	});
	if (profile.home === "ARS")
		await adminDb.bookPeriod.updateMany({
			where: { bookId: book.id },
			data: { rateType: "blue" },
		});
	const envelopes = Object.fromEntries(
		book.envelopes.map((e) => [e.name, e.id]),
	);
	const periods = book.periods.map((p) => ({
		fromMonth: p.fromMonth,
		startDay: p.startDay,
	}));
	const home = profile.home;
	// A USD value per unit of the home currency: ARS 1,500 per USD, JPY 150, KWD 0.3.
	const perUsd = { ARS: 1500, JPY: 150, KWD: 0.3, USD: 1 }[home] ?? 1;
	const usdOf = (amount: number) => (amount / perUsd).toFixed(8);
	// This month's start in the user's own fiscal month: the rows of k = 0 sit just after it.
	const thisMonth = spentRange(now, profile.startDay, zone).start.getTime();
	for (const k of [3, 2, 1, 0]) {
		const at = (days: number) =>
			k === 0
				? new Date(thisMonth + days * 60 * 60_000)
				: new Date(now.getTime() - (k * 30 - days) * DAY);
		await row(userId, home, {
			at: at(2),
			amount: "3000",
			usd: usdOf(3000),
			categoryId: dining,
			booked: true,
		});
		await row(userId, home, {
			at: at(3),
			amount: "10",
			currency: "USD",
			usd: "10",
			categoryId: dining,
		});
		await row(userId, home, {
			at: at(4),
			amount: "100",
			currency: "USD",
			usd: "100",
			categoryId: rent,
			booked: false,
		});
		await row(userId, home, {
			at: at(5),
			amount: "400",
			usd: usdOf(400),
			categoryId: dining,
			direction: "IN",
			inType: "REFUND",
			booked: true,
		});
		await row(userId, home, {
			at: at(6),
			amount: "20000",
			usd: usdOf(20000),
			direction: "IN",
			inType: "INCOME",
			booked: true,
		});
		const month = budgetMonthOf(isoDateIn(at(2), zone), periods);
		for (const [name, amount] of [
			["Dining", "5000"],
			["Rent", "1000"],
		] as const)
			await adminDb.budgetMovement.create({
				data: {
					id: randomUUID(),
					bookId: book.id,
					month,
					toEnvelopeId: envelopes[name] as string,
					amount,
					kind: "ASSIGN",
					actorUserId: userId,
				},
			});
	}
	await adminDb.wealthTransfer.create({
		data: {
			id: randomUUID(),
			bookId: book.id,
			direction: "TO_WEALTH",
			envelopeId: envelopes.Dining as string,
			date: new Date(now.getTime() - 40 * DAY),
			amount: "100",
			actorUserId: userId,
		},
	});
	// The first read closes the months before this one.
	await getMonth(userId, undefined, now);
	return { bookId: book.id, envelopes, rent, dining };
}
