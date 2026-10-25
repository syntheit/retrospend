/**
 * The envelope reads for transports (tRPC now, /api/v1 later): each opens
 * one RLS transaction for the user and returns contract DTOs. Writes go
 * through the money mutations instead (preview + apply).
 */
import type {
	CoverOverview,
	FillFromTargetsOutput,
	GetMonthOutput,
	HistoryInput,
	HistoryOutput,
	OwedDto,
	SetupPresetOutput,
	VerdictDto,
} from "~/lib/schemas/envelope";
import type { MonthSummaryOutput } from "~/lib/schemas/envelope-book";
import { db } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import type { Prisma } from "~prisma";
import { setupPreset } from "./book.service";
import { EnvelopeError } from "./errors";
import { ensureMonthsClosed } from "./month-close.service";
import {
	coverSourcesIn,
	fillFromTargetsIn,
	historyIn,
	monthViewIn,
} from "./month-read";
import type { SetupStyle } from "./presets";
import { runPendingRules } from "./rule.service";
import { owedIn, saveShareDefaults } from "./splits.service";
import { monthSummaryIn } from "./summary.service";
import type { Minor, MonthKey } from "./types";
import { touchOpened } from "./welcome.service";

function read<T>(
	userId: string,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	return userTransaction(db, userId, work);
}

/** A month read after the lazy close (SPEC §5.5): months before today's close on first read. */
async function closedView(
	tx: Prisma.TransactionClient,
	userId: string,
	now: Date,
	month?: MonthKey,
) {
	await prepareRead(tx, userId, now);
	return monthViewIn(tx, userId, now, month);
}

/**
 * The lazy steps before any budget read (02 §5.3), each a cheap check when
 * nothing waits: close finished months, then run income rules on money in
 * nobody ran them on (sidecar rows, edits, deletes). Needs you and other
 * readers of the month view call this first too.
 */
export async function prepareRead(
	tx: Prisma.TransactionClient,
	userId: string,
	now: Date,
) {
	await ensureMonthsClosed(tx, userId, now);
	await runPendingRules(tx, userId, now);
}

/**
 * Null when the user has no budget yet ("Just track"). Stores the share
 * categories the smart default picked (D19), so they stay put; the view
 * already counts them, so storing changes no number.
 */
export async function getMonth(
	userId: string,
	month?: MonthKey,
	now = new Date(),
): Promise<GetMonthOutput | null> {
	const view = await read(userId, async (tx) => {
		const v = await closedView(tx, userId, now, month);
		if (v?.loaded.splits.unsaved.length)
			await saveShareDefaults(tx, v.loaded.splits.unsaved);
		// Opening the budget is what Welcome back measures time away from.
		if (v) await touchOpened(tx, userId, now);
		return v;
	});
	return view?.dto ?? null;
}

/** What a closed month ended with (SPEC §6.6); null when it has not closed. */
export function getMonthSummary(
	userId: string,
	month: MonthKey,
	now = new Date(),
): Promise<MonthSummaryOutput | null> {
	return read(userId, async (tx) => {
		await ensureMonthsClosed(tx, userId, now);
		return monthSummaryIn(tx, userId, month);
	});
}

/** Money owed, per person and currency, with names; null without a budget. */
export function getOwed(
	userId: string,
	now = new Date(),
): Promise<OwedDto | null> {
	return read(userId, (tx) => owedIn(tx, userId, now));
}

/** The top of Budget and Home's card (`BudgetPlan.verdict(ym)`), null without a budget. */
export async function getVerdict(
	userId: string,
	month?: MonthKey,
	now = new Date(),
): Promise<VerdictDto | null> {
	const view = await read(userId, (tx) => closedView(tx, userId, now, month));
	return view?.dto.verdict ?? null;
}

export async function getLeftToSpend(
	userId: string,
	month?: MonthKey,
	now = new Date(),
): Promise<GetMonthOutput["leftToSpend"] | null> {
	const view = await read(userId, (tx) => closedView(tx, userId, now, month));
	return view?.dto.leftToSpend ?? null;
}

export function getFillFromTargets(
	userId: string,
	month?: MonthKey,
	amount?: Minor,
	now = new Date(),
): Promise<FillFromTargetsOutput> {
	return read(userId, async (tx) => {
		await prepareRead(tx, userId, now);
		return fillFromTargetsIn(tx, userId, now, month, amount);
	});
}

export function getCoverSources(
	userId: string,
	envelopeId: string,
	month?: MonthKey,
	now = new Date(),
): Promise<CoverOverview> {
	return read(userId, (tx) =>
		coverSourcesIn(tx, userId, now, envelopeId, month),
	);
}

export function getHistory(
	userId: string,
	input: HistoryInput,
	now = new Date(),
): Promise<HistoryOutput> {
	return read(userId, (tx) => historyIn(tx, userId, now, input));
}

export async function getSetupPreset(
	userId: string,
	style: SetupStyle,
): Promise<SetupPresetOutput> {
	return read(userId, async (tx) => {
		if (
			await tx.budgetBook.findFirst({
				where: { createdById: userId, isPersonal: true },
				select: { id: true },
			})
		)
			throw new EnvelopeError("BOOK_EXISTS", "you already have a budget");
		return setupPreset(tx, userId, style);
	});
}
