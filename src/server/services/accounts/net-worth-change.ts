/**
 * Why net worth moved over a span (MONEY-MOVES I10, §4.6 breakdown), in home
 * minor units. Pure: the caller loads the histories.
 *
 * Every part except revaluation is read from tagged rows: legs by what wrote
 * them, balance updates (their jump over what was recorded: Not logged),
 * accounts added and closed. Revaluation is what the value moved beyond
 * those: rates and rate type switches (D3). So the parts always add up to
 * the change, to the minor unit, and a part that is wrong shows up as a
 * revaluation a test can see.
 *
 * Balances with people have no history yet, so the span holds Owed to you
 * and You owe at today's value (the Wealth chart does the same); paying
 * someone back moves no part (I11).
 */
import type { Decimal } from "@prisma/client/runtime/index-browser";
import { dec, toMinor } from "~/server/services/envelope/units";
import type { AccountLegSource } from "~prisma";
import { balanceEffect } from "./places";
import {
	type AccountHistory,
	addDays,
	closedOn,
	dayOf,
	endOfDay,
	homeOfStored,
	type LegFacts,
	storedOn,
	valueOn,
} from "./series";
import { homeValue, type RatePick } from "./valuation";

export const CHANGE_PARTS = [
	"income",
	"spending",
	"exchange",
	"notLogged",
	"revaluation",
	"opened",
	"closed",
] as const;

export type ChangePart = (typeof CHANGE_PARTS)[number];

export interface NetWorthChange {
	/** Minor units of the home currency. */
	readonly total: number;
	readonly parts: Readonly<Record<ChangePart, number>>;
	readonly currency: string;
}

/** Legs with no account, one currency: Not tracked (N75). */
export interface NotTrackedHistory {
	readonly currency: string;
	readonly legs: readonly LegFacts[];
}

const PART_OF: Record<
	Exclude<AccountLegSource, "BALANCE_UPDATE">,
	ChangePart
> = {
	INCOME: "income",
	FEE: "spending",
	TRANSFER: "exchange",
};

class Unavailable extends Error {}

interface Ctx {
	readonly from: string;
	readonly to: string;
	readonly home: string;
	readonly pick: RatePick;
}

const inSpan = (ctx: Ctx, day: string) => day > ctx.from && day <= ctx.to;

function minor(ctx: Ctx, value: Decimal | null): number {
	if (value === null) throw new Unavailable();
	return toMinor(value, ctx.home);
}

/** A leg's booked home value (I20); a leg booked in another home currency is valued on its day. */
function legHome(
	ctx: Ctx,
	leg: LegFacts,
	revalue: (leg: LegFacts) => Decimal | null,
): number {
	if (leg.homeAmount !== null && leg.homeCurrency === ctx.home) {
		return toMinor(leg.homeAmount, ctx.home);
	}
	return minor(ctx, revalue(leg));
}

function addParts(
	into: Record<ChangePart, number>,
	part: ChangePart,
	v: number,
) {
	into[part] += v;
}

function accountParts(
	ctx: Ctx,
	history: AccountHistory,
	parts: Record<ChangePart, number>,
): number {
	const { account } = history;
	const closeDay = account.closedAt ? dayOf(account.closedAt) : null;
	if (closeDay && closeDay <= ctx.from) return 0;
	const v0 = minor(ctx, valueOn(history, ctx.from, ctx.home, ctx.pick));
	const v1 = minor(ctx, valueOn(history, ctx.to, ctx.home, ctx.pick));
	const open = (day: string) => !closeDay || day < closeDay;
	let explained = 0;
	const add = (part: ChangePart, v: number) => {
		addParts(parts, part, v);
		explained += v;
	};

	for (const leg of history.legs) {
		const day = dayOf(leg.date);
		if (leg.source === "BALANCE_UPDATE" || !inSpan(ctx, day) || !open(day))
			continue;
		const revalue = (l: LegFacts) =>
			homeOfStored(
				history,
				balanceEffect(account.type, l.amount),
				day,
				ctx.home,
				ctx.pick,
			);
		add(PART_OF[leg.source], legHome(ctx, leg, revalue));
	}
	history.checkpoints.forEach((checkpoint, i) => {
		const day = dayOf(checkpoint.date);
		if (!inSpan(ctx, day) || !open(day)) return;
		const after = minor(
			ctx,
			homeOfStored(history, checkpoint.balance, day, ctx.home, ctx.pick),
		);
		if (i === 0) {
			add("opened", after);
			return;
		}
		const was = storedOn(history, day, checkpoint.recordedAt) ?? dec(0);
		add(
			"notLogged",
			after - minor(ctx, homeOfStored(history, was, day, ctx.home, ctx.pick)),
		);
	});
	if (closeDay && inSpan(ctx, closeDay)) {
		const before = addDays(closeDay, -1);
		add(
			"closed",
			-minor(
				ctx,
				closedOn(account, before)
					? dec(0)
					: valueOn(history, before, ctx.home, ctx.pick),
			),
		);
	}
	addParts(parts, "revaluation", v1 - v0 - explained);
	return v1 - v0;
}

function notTrackedParts(
	ctx: Ctx,
	nt: NotTrackedHistory,
	parts: Record<ChangePart, number>,
): number {
	const valued = { currency: nt.currency, rateType: null, storedRate: null };
	const valueAt = (day: string) =>
		minor(
			ctx,
			homeValue(
				ctx.pick,
				valued,
				nt.legs
					.filter((l) => dayOf(l.date) <= day)
					.reduce((t, l) => t.add(l.amount), dec(0)),
				ctx.home,
				endOfDay(day),
			),
		);
	const change = valueAt(ctx.to) - valueAt(ctx.from);
	let explained = 0;
	for (const leg of nt.legs) {
		const day = dayOf(leg.date);
		if (leg.source === "BALANCE_UPDATE" || !inSpan(ctx, day)) continue;
		const v = legHome(ctx, leg, (l) =>
			homeValue(ctx.pick, valued, l.amount, ctx.home, endOfDay(day)),
		);
		addParts(parts, PART_OF[leg.source], v);
		explained += v;
	}
	addParts(parts, "revaluation", change - explained);
	return change;
}

/**
 * Net worth change from the end of `from` to the end of `to` (YYYY-MM-DD),
 * with its parts. Null when a rate is missing for any day it needs (R14).
 */
export function netWorthChange(
	histories: readonly AccountHistory[],
	notTracked: readonly NotTrackedHistory[],
	span: { from: string; to: string },
	homeCurrency: string,
	pick: RatePick,
): NetWorthChange | null {
	const ctx: Ctx = { ...span, home: homeCurrency, pick };
	const parts = Object.fromEntries(CHANGE_PARTS.map((p) => [p, 0])) as Record<
		ChangePart,
		number
	>;
	try {
		let total = 0;
		for (const history of histories) total += accountParts(ctx, history, parts);
		for (const nt of notTracked) total += notTrackedParts(ctx, nt, parts);
		return { total, parts, currency: homeCurrency };
	} catch (error) {
		if (error instanceof Unavailable) return null;
		throw error;
	}
}
