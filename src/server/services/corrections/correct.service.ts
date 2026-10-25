/**
 * Correct a settled split (MONEY-MOVES 1.11): the creator says what the
 * split should be now; the difference is written as correction rows dated
 * today, in the same project, and the original stays as it was. The scope
 * reopens by the difference only. All through the caller's transaction, so
 * the preview is this same write rolled back.
 *
 * Ids derive from the client's id (`id`, `id~1`, ...): a retry finds its own
 * rows and writes nothing twice. Undo deletes exactly those rows and puts the
 * fix requests the correction answered back to what they were.
 */
import { dayKey, parseDateOnlyIn } from "@retrospend/domain/time-zone";
import { TRPCError } from "@trpc/server";
import type { CorrectInput, CorrectResult } from "~/lib/schemas/corrections";
import {
	resolveSplits,
	SplitComputationError,
} from "@retrospend/domain/shared-split-computation";
import type { Prisma } from "~prisma";
import { forgetMonthViews } from "../envelope/month-read";
import { fromMinor, toMinor } from "../envelope/units";
import { logAudit } from "../shared-expenses/audit-log";
import { noticeSender } from "./notices";
import {
	CorrectionPlanError,
	differencesOf,
	type Party,
	type PlannedRow,
	partyKey,
	planCorrection,
} from "./plan";
import {
	allowedPeople,
	effectiveRows,
	type LoadedSplit,
	loadSplit,
	partyOf,
	shareCategories,
} from "./split-state";

type Tx = Prisma.TransactionClient;

export interface CorrectContext {
	readonly timeZone?: string;
	/** Notifications the write queues; the transport sends them after it commits. */
	readonly notify?: (() => Promise<void>)[];
}

const bad = (message: string) =>
	new TRPCError({ code: "BAD_REQUEST", message });

export const rowIdOf = (id: string, index: number) =>
	index === 0 ? id : `${id}~${index}`;

const toParty = (p: { type: Party["participantType"]; id: string }): Party =>
	partyOf(p.type, p.id);

/** What the split should be, with the server's split rounding, in minor units. */
function desiredOf(split: LoadedSplit, input: CorrectInput) {
	const { currency } = split.original;
	const paidBy = toParty(input.paidBy);
	let shares: ReturnType<typeof resolveSplits>;
	try {
		shares = resolveSplits({
			mode: input.splitMode,
			amount: Number(input.amount),
			currency,
			participants: input.splitWith.map((l) => ({
				...toParty(l.participant),
				shareAmount:
					l.shareAmount === undefined ? undefined : Number(l.shareAmount),
				sharePercentage: l.sharePercentage,
				shareUnits: l.shareUnits,
			})),
			paidBy,
		});
	} catch (error) {
		if (error instanceof SplitComputationError) throw bad(error.message);
		throw error;
	}
	return {
		payer: paidBy,
		categoryId: input.categoryId,
		amountMinor: toMinor(input.amount, currency),
		shares: shares.map((s) => ({
			party: partyOf(s.participantType, s.participantId),
			minor: toMinor(String(s.shareAmount), currency),
		})),
	};
}

/** The creator of the original, on a settled split, and not a correction row. */
function assertCanCorrect(split: LoadedSplit, userId: string) {
	const { original } = split;
	if (original.correctsId) throw bad("Correct the original expense instead");
	if (original.createdByType !== "user" || original.createdById !== userId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Only the person who added this expense can correct it",
		});
	}
	if (!original.isLocked)
		throw bad("This expense is not settled. Edit it instead");
}

/** Today in the user's zone, stored the way expense rows are (the zone's midnight). */
const todayRow = (now: Date, timeZone?: string) =>
	parseDateOnlyIn(dayKey(now, timeZone), timeZone);

/** The rows an earlier try with this id wrote, as a result; null when the id is new. */
async function existingCorrection(
	tx: Tx,
	split: LoadedSplit,
	input: CorrectInput,
): Promise<CorrectResult | null> {
	const ids = Array.from({ length: MAX_ROWS }, (_, i) => rowIdOf(input.id, i));
	const rows = await tx.sharedTransaction.findMany({
		where: { id: { in: ids } },
		include: { splitParticipants: true },
		orderBy: { id: "asc" },
	});
	if (rows.length === 0) return null;
	const { original } = split;
	const mine = rows.every(
		(r) =>
			r.correctsId === original.id &&
			r.createdByType === original.createdByType &&
			r.createdById === original.createdById,
	);
	if (!mine) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "that id was already used for another change",
		});
	}
	const planned: PlannedRow[] = rows.map((r) => ({
		payer: partyOf(r.paidByType, r.paidById),
		categoryId: r.categoryId,
		amountMinor: toMinor(r.amount.toString(), r.currency),
		shares: r.splitParticipants.map((p) => ({
			party: partyOf(p.participantType, p.participantId),
			minor: toMinor(p.shareAmount.toString(), r.currency),
		})),
	}));
	return {
		transactionIds: rows.map((r) => r.id),
		currency: original.currency,
		differences: differencesView(planned),
		resolvedRequests: [],
	};
}

const differencesView = (rows: readonly PlannedRow[]) =>
	differencesOf(rows).map((d) => ({
		participant: {
			type: d.party.participantType,
			id: d.party.participantId,
		},
		paidMinor: d.paidMinor,
		shareMinor: d.shareMinor,
	}));

/**
 * The status each person's share of a correction starts in. The creator is
 * accepted. A person on Retrospend whose share goes up gets to review it
 * (a Needs you item); a ghost cannot, and a share that goes down only
 * undoes what they already accepted.
 */
function statusOf(actor: Party, p: Party, minor: number) {
	if (partyKey(actor) === partyKey(p)) return "ACCEPTED" as const;
	if (p.participantType === "shadow" || minor < 0)
		return "AUTO_ACCEPTED" as const;
	return "PENDING" as const;
}

async function openPeriodId(tx: Tx, projectId: string | null) {
	if (!projectId) return null;
	const open = await tx.billingPeriod.findFirst({
		where: { projectId, status: "OPEN" },
		select: { id: true },
	});
	return open?.id ?? null;
}

async function writeRows(
	tx: Tx,
	split: LoadedSplit,
	input: CorrectInput,
	rows: readonly PlannedRow[],
	date: Date,
): Promise<string[]> {
	const { original } = split;
	const actor = partyOf("user", original.createdById);
	const categories = shareCategories(split);
	const billingPeriodId = await openPeriodId(tx, original.projectId);
	const ids: string[] = [];
	for (const [index, row] of rows.entries()) {
		const id = rowIdOf(input.id, index);
		ids.push(id);
		await tx.sharedTransaction.create({
			data: {
				id,
				description: input.description,
				amount: fromMinor(row.amountMinor, original.currency).toString(),
				currency: original.currency,
				// The booked rate of the original: a correction never revalues it.
				exchangeRate: original.exchangeRate,
				date,
				categoryId: row.categoryId,
				splitMode: "EXACT",
				paidByType: row.payer.participantType,
				paidById: row.payer.participantId,
				createdByType: original.createdByType,
				createdById: original.createdById,
				projectId: original.projectId,
				billingPeriodId,
				correctsId: original.id,
				splitParticipants: {
					create: row.shares.map((s) => {
						const kept = categories.get(
							`${partyKey(row.payer)}|${row.categoryId ?? ""}|${partyKey(s.party)}`,
						);
						const status = statusOf(actor, s.party, s.minor);
						return {
							participantType: s.party.participantType,
							participantId: s.party.participantId,
							shareAmount: fromMinor(s.minor, original.currency).toString(),
							verificationStatus: status,
							verifiedAt: status === "PENDING" ? undefined : date,
							hasUnseenChanges: status !== "ACCEPTED",
							categoryId: kept?.categoryId ?? null,
							categorySource: kept?.source ?? null,
						};
					}),
				},
			},
		});
	}
	return ids;
}

/** Open requests to fix this split are answered by the correction. */
async function answerRequests(
	tx: Tx,
	original: string,
	fixedBy: string,
	now: Date,
) {
	const open = await tx.fixRequest.findMany({
		where: { transactionId: original, status: { in: ["PENDING", "ACCEPTED"] } },
		select: {
			id: true,
			status: true,
			requestedByType: true,
			requestedById: true,
		},
	});
	if (open.length > 0) {
		await tx.fixRequest.updateMany({
			where: { id: { in: open.map((r) => r.id) } },
			data: { status: "FIXED", answeredAt: now, fixedById: fixedBy },
		});
	}
	return open;
}

/** Everyone to tell: users whose paid or share moved, and whoever asked for the fix. */
function recipients(
	userId: string,
	rows: readonly PlannedRow[],
	askers: readonly { requestedByType: string; requestedById: string }[],
) {
	const ids = new Set<string>();
	for (const d of differencesOf(rows))
		if (d.party.participantType === "user") ids.add(d.party.participantId);
	for (const a of askers)
		if (a.requestedByType === "user") ids.add(a.requestedById);
	ids.delete(userId);
	return [...ids];
}

/**
 * Writes the correction. Nothing changes (and nothing is written) when the
 * split already is what was asked for.
 */
export async function correctSplit(
	tx: Tx,
	userId: string,
	input: CorrectInput,
	ctx: CorrectContext = {},
): Promise<CorrectResult> {
	// Two corrections at once would both plan from the same state.
	await tx.$queryRaw`SELECT "id" FROM "shared_transaction" WHERE "id" = ${input.transactionId} FOR UPDATE`;
	const split = await loadSplit(tx, input.transactionId);
	assertCanCorrect(split, userId);
	const again = await existingCorrection(tx, split, input);
	if (again) return again;

	const desired = desiredOf(split, input);
	const allowed = await allowedPeople(tx, split);
	for (const who of [desired.payer, ...desired.shares.map((s) => s.party)]) {
		if (!allowed.has(partyKey(who)))
			throw bad("Add new people in a new expense, not in a correction");
	}
	let planned: PlannedRow[];
	try {
		planned = planCorrection(effectiveRows(split), desired);
	} catch (error) {
		if (error instanceof CorrectionPlanError) throw bad(error.message);
		throw error;
	}
	const { original } = split;
	if (planned.length === 0) {
		return {
			transactionIds: [],
			currency: original.currency,
			differences: [],
			resolvedRequests: [],
		};
	}
	if (planned.length > MAX_ROWS) throw bad("Too many changes at once");

	const now = new Date();
	const ids = await writeRows(
		tx,
		split,
		input,
		planned,
		todayRow(now, ctx.timeZone),
	);
	const answered = await answerRequests(tx, original.id, ids[0] as string, now);
	const differences = differencesView(planned);
	await logAudit(tx, {
		actor: partyOf("user", userId),
		action: "CORRECTED",
		targetType: "SHARED_TRANSACTION",
		targetId: original.id,
		projectId: original.projectId ?? undefined,
		changes: {
			correctionIds: ids,
			currency: original.currency,
			differences: differences.map((d) => ({
				id: `${d.participant.type}:${d.participant.id}`,
				paidMinor: d.paidMinor,
				shareMinor: d.shareMinor,
			})),
			answeredRequestIds: answered.map((r) => r.id),
		},
	});
	for (const to of recipients(userId, planned, answered)) {
		ctx.notify?.push(
			noticeSender({
				kind: "SPLIT_CORRECTED",
				to,
				from: userId,
				transactionId: original.id,
				correctionIds: ids,
			}),
		);
	}
	forgetMonthViews(tx);
	return {
		transactionIds: ids,
		currency: original.currency,
		differences,
		resolvedRequests: answered.map((r) => ({
			id: r.id,
			previousStatus: r.status,
		})),
	};
}

const MAX_ROWS = 6;
