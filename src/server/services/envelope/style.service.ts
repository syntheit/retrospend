/**
 * Switching styles (SPEC §4.4, B8: styles are presets, not modes). A switch
 * changes the book's style and funding source and, only when the person
 * keeps the box checked, the leftover rule of Monthly envelopes still on the
 * old style's default. It writes nothing else, except:
 *
 * - Limits to an income style: one Adjustment so To assign = what you have
 *   now minus what the envelopes hold (To assign + Σ Left + next month's
 *   assigned becomes exactly what you have). The starting money counts as
 *   confirmed. Plan funding stops; this month's batch stays.
 * - An income style to Limits: plan funding starts with the next month
 *   (`planFundFrom`), so this month's numbers do not move.
 *
 * revertStyle puts back what a switch changed (its undo). Pause ("Just
 * track") keeps the book and hides its Needs you items; resume opens Welcome
 * back.
 */
import { z } from "zod";
import {
	type PauseResult,
	type RevertStyleInput,
	type RevertStyleResult,
	type SetStyleInput,
	type SetStyleResult,
	stylePreviousSchema,
} from "~/lib/schemas/envelope-book";
import { Prisma } from "~prisma";
import { removeAdjustment, writeAdjustment } from "./adjustment";
import { budgetHolds } from "./bank";
import { fundingSourceFor, leftoverDefault } from "./book.service";
import { addMonths } from "./calendar";
import { EnvelopeError } from "./errors";
import { findPersonalBook } from "./inputs";
import { forgetMonthViews, monthViewIn } from "./month-read";
import { lockBook } from "./movement-state";

type Tx = Prisma.TransactionClient;

/** budget_book.styleUndo: the last switch's previous settings and its Adjustment. */
const styleUndoSchema = z.object({
	previous: stylePreviousSchema.extend({
		startingMoneyConfirmedAt: z.coerce.date().nullable(),
	}),
	adjustmentId: z.string().nullable(),
});

async function lockedBook(tx: Tx, userId: string) {
	const book = await findPersonalBook(tx, userId);
	if (!book?.defaultEnvelopeId)
		throw new EnvelopeError("NO_BOOK", "start a budget first");
	await lockBook(tx, book.id);
	return book;
}

export async function setStyle(
	tx: Tx,
	userId: string,
	input: SetStyleInput,
	now: Date,
): Promise<SetStyleResult> {
	const book = await lockedBook(tx, userId);
	if (book.style === input.style)
		throw new EnvelopeError("INVALID", "that is your style already");
	const view = await monthViewIn(tx, userId, now);
	if (!view) throw new EnvelopeError("NO_BOOK", "start a budget first");
	const H = book.currency;
	const c = view.loaded.input.currentMonth;
	const from = book.fundingSource;
	const to = fundingSourceFor(input.style);
	const leavingLimits = from === "TARGETS" && to === "INCOME";
	if (leavingLimits && input.haveNowMinor === undefined)
		throw new EnvelopeError("INVALID", "how much do you have right now?");
	if (!leavingLimits && input.haveNowMinor !== undefined)
		throw new EnvelopeError(
			"INVALID",
			"only leaving Limits asks for money now",
		);
	const oldRule = leftoverDefault(book.style);
	const newRule = leftoverDefault(input.style);
	const ruleChanges =
		input.leftovers === "STYLE_DEFAULT" && oldRule !== newRule
			? book.envelopes
					.filter(
						(e) =>
							e.kind === "MONTHLY" &&
							e.archivedAt === null &&
							e.leftoverRule === oldRule,
					)
					.map((e) => ({ envelopeId: e.id, from: oldRule, to: newRule }))
			: [];
	const previous = {
		style: book.style,
		fundingSource: from,
		planFundFrom: book.planFundFrom,
		startingMoneyConfirmedAt: book.startingMoneyConfirmedAt,
		rules: ruleChanges.map((r) => ({ envelopeId: r.envelopeId, rule: r.from })),
	};
	const adjustment = leavingLimits
		? await writeAdjustment(tx, userId, {
				id: input.id,
				signedMinor: (input.haveNowMinor ?? 0) - budgetHolds(view),
				currency: H,
				rateType: view.loaded.valuation.defaultRateType,
				date: now,
				today: view.loaded.today,
			})
		: null;
	const fundedFrom =
		to === "TARGETS" && from !== "TARGETS" ? addMonths(c, 1) : null;
	await tx.budgetBook.update({
		where: { id: book.id },
		data: {
			style: input.style,
			fundingSource: to,
			planFundFrom: to === "TARGETS" ? (fundedFrom ?? book.planFundFrom) : null,
			...(leavingLimits && !book.startingMoneyConfirmedAt
				? { startingMoneyConfirmedAt: now }
				: {}),
			// What the undo puts back, kept here so the undo never trusts a client.
			styleUndo: {
				previous: {
					...previous,
					startingMoneyConfirmedAt:
						previous.startingMoneyConfirmedAt?.toISOString() ?? null,
				},
				adjustmentId: adjustment?.expenseId ?? null,
			},
		},
	});
	for (const r of ruleChanges)
		await tx.envelope.update({
			where: { id: r.envelopeId },
			data: { leftoverRule: r.to },
		});
	forgetMonthViews(tx);
	return {
		bookId: book.id,
		style: input.style,
		fundingSource: to,
		fundedFrom,
		ruleChanges,
		adjustment:
			adjustment?.expenseId != null
				? { id: adjustment.expenseId, amount: adjustment.amount }
				: null,
		previous,
	};
}

/** The undo of a switch: style, funding, rules and the Adjustment it wrote. */
export async function revertStyle(
	tx: Tx,
	userId: string,
	_input: RevertStyleInput,
): Promise<RevertStyleResult> {
	const book = await lockedBook(tx, userId);
	// What the last switch changed, as the server stored it (never the client's copy).
	const stored = styleUndoSchema.safeParse(book.styleUndo);
	if (!stored.success)
		throw new EnvelopeError("INVALID", "there is no style change to undo");
	const { previous: p, adjustmentId } = stored.data;
	const own = new Set(book.envelopes.map((e) => e.id));
	if (p.rules.some((r) => !own.has(r.envelopeId)))
		throw new EnvelopeError("NOT_FOUND", "no such envelope");
	if (adjustmentId) await removeAdjustment(tx, userId, adjustmentId);
	await tx.budgetBook.update({
		where: { id: book.id },
		data: {
			style: p.style,
			fundingSource: p.fundingSource,
			planFundFrom: p.planFundFrom,
			startingMoneyConfirmedAt: p.startingMoneyConfirmedAt,
			styleUndo: Prisma.DbNull,
		},
	});
	for (const r of p.rules)
		await tx.envelope.update({
			where: { id: r.envelopeId },
			data: { leftoverRule: r.rule },
		});
	forgetMonthViews(tx);
	return { bookId: book.id, style: p.style, fundingSource: p.fundingSource };
}

/** "Just track" (SPEC §4.4): the book stays, its items go quiet. */
export async function pauseBook(
	tx: Tx,
	userId: string,
	now: Date,
): Promise<PauseResult> {
	const book = await lockedBook(tx, userId);
	if (book.pausedAt) return { paused: true, welcomeBackFrom: null };
	await tx.budgetBook.update({
		where: { id: book.id },
		data: { pausedAt: now },
	});
	forgetMonthViews(tx);
	return { paused: true, welcomeBackFrom: null };
}

/** Back from Just track: Welcome back waits from the day it paused. */
export async function resumeBook(tx: Tx, userId: string): Promise<PauseResult> {
	const book = await lockedBook(tx, userId);
	if (!book.pausedAt)
		return { paused: false, welcomeBackFrom: book.welcomeBackFrom };
	const welcomeBackFrom = book.welcomeBackFrom ?? book.pausedAt;
	await tx.budgetBook.update({
		where: { id: book.id },
		data: { pausedAt: null, welcomeBackFrom },
	});
	forgetMonthViews(tx);
	return { paused: false, welcomeBackFrom };
}
