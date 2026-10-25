/**
 * The read behind "Can I afford it?" (SYNTHESIS-r6 §4): the month the Budget
 * page shows, the amount asked about, and afford.ts's answer with its
 * numbers as Money. It writes nothing; "Add to Spending" and "Move money"
 * are separate previewed writes the client offers from the answer.
 */
import type { AffordInput, AffordResult } from "~/lib/schemas/envelope-crud";
import { db } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import type { Prisma } from "~prisma";
import { type AffordOffer, afford } from "./afford";
import { addMonths, daysBetween } from "./calendar";
import type { CloseRow } from "./close-rows";
import { EnvelopeError } from "./errors";
import type { MonthRead } from "./month-read";
import { monthRange } from "./months";
import { closedView, movedFirst } from "./read.service";
import type { Minor } from "./types";
import { mulDiv } from "./units";

type Tx = Prisma.TransactionClient;

/** The last closed months before `month` that count toward a usual day. */
const USUAL_MONTHS = 3;

/**
 * About what you spend a day on Spending envelopes: the last 3 closed months'
 * spending (net of refunds and shares) over their days. Null before a first
 * close or with nothing spent.
 */
function usualPerDay(
	closes: readonly CloseRow[],
	spendingIds: ReadonlySet<string>,
	month: number,
	periods: MonthRead["loaded"]["periods"],
): Minor | null {
	const recent = closes.filter((c) => c.month < month).slice(-USUAL_MONTHS);
	let spent = 0;
	let days = 0;
	for (const c of recent) {
		for (const e of c.summary.envelopes)
			if (spendingIds.has(e.id)) spent -= e.activity;
		const r = monthRange(c.month, periods);
		days += daysBetween(r.from, r.to) + 1;
	}
	return spent > 0 && days > 0 ? mulDiv(spent, 1, days) : null;
}

function offer(a: AffordOffer | null, H: string): AffordResult["action"] {
	if (!a) return null;
	if (a.kind === "PLAN_NEXT_MONTH") return a;
	const amount = { minor: a.amountMinor, currency: H };
	return a.kind === "ADD_TO_SPENDING"
		? { kind: a.kind, amount }
		: { kind: a.kind, envelopeId: a.envelopeId, amount };
}

export function affordIn(view: MonthRead, input: AffordInput): AffordResult {
	const dto = view.dto;
	const H = dto.book.currency;
	const money = (minor: Minor) => ({ minor, currency: H });
	const rows = dto.groups.flatMap((g) => g.envelopes);
	const style = dto.book.style;
	const wantsEnvelope = style === "EVERY_DOLLAR" || style === "LIMITS";
	const id = input.envelopeId ?? dto.book.defaultEnvelopeId;
	const picked = wantsEnvelope ? rows.find((e) => e.id === id) : undefined;
	if (wantsEnvelope && !picked)
		throw new EnvelopeError("NOT_FOUND", "no such envelope");
	const week =
		dto.verdict.lead.kind === "LEFT_THIS_WEEK"
			? {
					left: dto.verdict.lead.amount.minor,
					daysLeftInWeek: dto.verdict.daysLeft,
				}
			: null;
	const spendingIds = new Set(
		dto.groups
			.filter((g) => g.role === "SPENDING")
			.flatMap((g) => g.envelopes.map((e) => e.id)),
	);
	const usual = usualPerDay(
		view.loaded.closes,
		spendingIds,
		dto.month.key,
		view.loaded.periods,
	);
	const a = afford({
		style,
		month: dto.month.key,
		nextMonth: addMonths(dto.month.key, 1),
		amount: input.amountMinor,
		leftToSpend: {
			left: dto.leftToSpend.left.minor,
			daysLeft: dto.leftToSpend.daysLeft,
			notPlanned: dto.leftToSpend.notPlanned.minor,
		},
		week,
		envelope: picked
			? {
					id: picked.id,
					left: picked.left.minor,
					hasLimit: picked.target !== null,
					spent: Math.max(0, -picked.activity.minor),
				}
			: null,
		usualPerDay: usual,
	});
	return {
		month: dto.month.key,
		scope: a.scope,
		state: a.state,
		amount: money(input.amountMinor),
		envelopeId: a.envelopeId,
		left: money(a.left),
		after: money(a.after),
		short: money(a.short),
		perDay: money(a.perDay),
		daysLeft: a.daysLeft,
		usualPerDay: usual === null ? null : money(usual),
		notPlanned: money(dto.leftToSpend.notPlanned.minor),
		spent: money(a.spent),
		action: offer(a.action, H),
		incomplete: dto.incomplete,
	};
}

/** Null without a budget ("Just track"). */
export function getAfford(
	userId: string,
	input: AffordInput,
	now = new Date(),
): Promise<AffordResult | null> {
	return movedFirst(userId, now, null, () =>
		userTransaction(db, userId, async (tx: Tx) => {
			const view = await closedView(tx, userId, now, input.month);
			return view ? affordIn(view, input) : null;
		}),
	);
}
