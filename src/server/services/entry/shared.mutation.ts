/**
 * Shared expenses as money mutations (R30): the Add expense sheet previews
 * the same SharedTransactionService write it saves, on the preview's
 * transaction. Notifications go into `notify` and the transport sends them
 * after apply commits; a preview drops them, so it never tells anyone.
 *
 * - sharedExpense.create: its undo is sharedExpense.delete of the new row
 *   with `retract`, so the people on it are not told twice.
 * - sharedExpense.update: its undo is another update with the values, payer
 *   and split it had (the people on it verify again, as after any edit).
 * - sharedExpense.delete: confirmed with a named button, since it changes
 *   other people's balances (ADD-EXPENSE-R2: shared delete). The web keeps no
 *   Undo for it; the phone (R15) does, so a delete that asks for it
 *   (`keepForUndo`) of your own expense keeps the expense, every share and the answers people gave in a stash, in
 *   the same transaction. The one thing it cannot put back is a payment the
 *   delete voided (`settled: "VOID_PAYMENT"`), so that delete gives no stash.
 * - sharedExpense.restore: the undo of that delete. The expense comes back
 *   with the same id and every share as it was, the people on it are told it
 *   is theirs again, and each stash works once, for the person who deleted.
 */
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";
import type { AnsweredFix } from "../corrections/fix-request.service";
import { GLANCE_SPENT } from "../figures/spend-pace";
import type { MoneyMutation } from "../preview/types";
import { logAudit } from "../shared-expenses/audit-log";
import { peopleToTell } from "../shared-expenses/delete-tell";
import { noticeRestored } from "../shared-expenses/restore-notice";
import { serializeTransaction } from "../shared-expenses/serialize";
import {
	restoreShared,
	type SharedSnapshot,
	snapshotShared,
} from "../shared-expenses/snapshot";
import { SharedTransactionService } from "../shared-expenses/transaction.service";
import type { ParticipantRef } from "../shared-expenses/types";
import { RETRACT_WINDOW_MS, retractSplitNotices } from "./notices";
import { putUndoStash, takeUndoStash } from "./undo-stash";

type Tx = Prisma.TransactionClient;
type Service = SharedTransactionService;

export type CreateSharedInput = Parameters<Service["create"]>[0];
export type UpdateSharedInput = Parameters<Service["update"]>[0];

/** Notifications the write queued; the transport sends them once it committed. */
export interface Deferred {
	readonly notify?: (() => Promise<void>)[];
}

/** With the envelope budget: a split moves To assign, Left to spend and what is held for others (D12). */
export const SHARED_FIGURES = [
	"owed.owedToYou",
	"owed.youOwe",
	"spent",
	GLANCE_SPENT,
	"budget.notPlannedYet",
	"budget.leftToSpend",
	"budget.heldForOthers",
];

function serviceFor(tx: Tx, userId: string, input: Deferred): Service {
	return new SharedTransactionService(
		tx,
		{ participantType: "user", participantId: userId },
		{ defer: input.notify ?? [] },
	);
}

/** An update with every field set: what `id` holds now. */
export type SharedRestore = Required<
	Pick<
		UpdateSharedInput,
		| "amount"
		| "currency"
		| "description"
		| "date"
		| "paidBy"
		| "splitWith"
		| "splitMode"
	>
> & {
	readonly id: string;
	readonly categoryId: string | null;
	readonly notes: string | null;
	readonly projectId: string | null;
};

/** The update that puts `id` back as it is now. */
async function restoreOf(tx: Tx, id: string): Promise<SharedRestore> {
	const row = await tx.sharedTransaction.findUnique({
		where: { id },
		include: { splitParticipants: true },
	});
	if (!row) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
	}
	const mode = row.splitMode;
	return {
		id,
		amount: Number(row.amount.toString()),
		currency: row.currency,
		description: row.description,
		categoryId: row.categoryId,
		date: row.date,
		notes: row.notes,
		projectId: row.projectId,
		paidBy: { participantType: row.paidByType, participantId: row.paidById },
		splitMode: mode,
		splitWith: row.splitParticipants.map((p) => ({
			participantType: p.participantType,
			participantId: p.participantId,
			...(mode === "EXACT"
				? { shareAmount: Number(p.shareAmount.toString()) }
				: mode === "PERCENTAGE" && p.sharePercentage
					? { sharePercentage: Number(p.sharePercentage.toString()) }
					: mode === "SHARES" && p.shareUnits
						? { shareUnits: p.shareUnits }
						: {}),
		})),
	};
}

export interface CreatedShared {
	readonly id: string;
	/** The open billing period it joined starts after its date. */
	readonly backdatedPeriod: string | null;
}

export const createSharedExpense: MoneyMutation<
	CreateSharedInput & Deferred,
	CreatedShared
> = {
	id: "sharedExpense.create",
	touches: SHARED_FIGURES,
	run: async (tx, { notify, ...input }, actor) => {
		const { transaction, backdatedWarning } = await serviceFor(
			tx,
			actor.userId,
			{ notify },
		).create(input);
		return {
			value: {
				id: transaction.id,
				backdatedPeriod: backdatedWarning?.periodLabel ?? null,
			},
			undo: {
				kind: "revert",
				mutation: "sharedExpense.delete",
				rows: [{ table: "shared_transaction", id: transaction.id }],
			},
		};
	},
};

export interface UpdatedShared {
	readonly id: string;
	readonly restore: SharedRestore;
	/** Requests to fix it that this edit answered (2C.2); the undo passes them back as `reopenFixRequests`. */
	readonly answered: readonly AnsweredFix[];
}

export const updateSharedExpense: MoneyMutation<
	UpdateSharedInput & Deferred,
	UpdatedShared
> = {
	id: "sharedExpense.update",
	touches: SHARED_FIGURES,
	run: async (tx, { notify, ...input }, actor) => {
		const restore = await restoreOf(tx, input.id);
		const open = await tx.fixRequest.findMany({
			where: {
				transactionId: input.id,
				askedType: "user",
				askedId: actor.userId,
				status: { in: ["PENDING", "ACCEPTED"] },
			},
			select: { id: true, status: true },
		});
		await serviceFor(tx, actor.userId, { notify }).update(input);
		// The service answers them on a real edit; report the ones it did.
		const now = await tx.fixRequest.findMany({
			where: { id: { in: open.map((r) => r.id) }, status: "FIXED" },
			select: { id: true },
		});
		const fixed = new Set(now.map((r) => r.id));
		const answered: AnsweredFix[] = open
			.filter((r) => fixed.has(r.id))
			.map((r) => ({
				id: r.id,
				previousStatus: r.status as AnsweredFix["previousStatus"],
			}));
		return {
			value: { id: input.id, restore, answered },
			undo: {
				kind: "revert",
				mutation: "sharedExpense.update",
				rows: [{ table: "shared_transaction", id: input.id }],
			},
		};
	},
};

export interface DeleteSharedInput extends Deferred {
	readonly id: string;
	readonly confirmUnsettled?: boolean;
	/** Payments already covered it (D12): keep them as a credit or void them. */
	readonly settled?: "KEEP_CREDIT" | "VOID_PAYMENT";
	/**
	 * The Undo of a create, right after it: the "split with you" notices are
	 * taken back and no "deleted" notice goes out (one non-event, not two).
	 * Honored only for your own expense within RETRACT_WINDOW_MS of creating it.
	 */
	readonly retract?: boolean;
	/** Keep what an undo needs (the phone's Undo, R15); the web asks for no stash. */
	readonly keepForUndo?: boolean;
}

/**
 * A retraction takes back what an add told people, so it is only for an add
 * nobody has answered. Once someone accepted or rejected their share, the
 * split is theirs too and the undo must not delete it silently: they delete
 * it the ordinary way, which asks to confirm.
 */
async function assertNobodyAnswered(tx: Tx, id: string, userId: string) {
	const answered = await tx.splitParticipant.count({
		where: {
			transactionId: id,
			verificationStatus: { in: ["ACCEPTED", "REJECTED"] },
			NOT: { participantType: "user", participantId: userId },
		},
	});
	if (answered > 0) {
		throw new TRPCError({
			code: "CONFLICT",
			message:
				"Someone already answered this expense, so it cannot be taken back. Delete it instead.",
		});
	}
}

export interface DeletedShared {
	readonly id: string;
	/**
	 * The other people who were on it, for the event that tells them (it is
	 * written once the rows are gone).
	 */
	readonly tell: readonly ParticipantRef[];
	/**
	 * sharedExpense.restore with this stash brings it back. Null when the delete
	 * cannot be taken back (a retraction, an expense someone else added, or one
	 * that may void payments) or was not asked for (`keepForUndo`).
	 */
	readonly stash: string | null;
}

export const deleteSharedExpense: MoneyMutation<
	DeleteSharedInput,
	DeletedShared
> = {
	id: "sharedExpense.delete",
	touches: SHARED_FIGURES,
	run: async (tx, input, actor) => {
		if (input.retract) await assertNobodyAnswered(tx, input.id, actor.userId);
		const row = await tx.sharedTransaction.findUnique({
			where: { id: input.id },
			select: { createdAt: true, createdByType: true, createdById: true },
		});
		const retract =
			!!input.retract &&
			!!row &&
			row.createdByType === "user" &&
			row.createdById === actor.userId &&
			Date.now() - row.createdAt.getTime() < RETRACT_WINDOW_MS;
		// A retraction still tells: the add's feed copy has usually reached them.
		const tell = await peopleToTell(tx, input.id, {
			participantType: "user",
			participantId: actor.userId,
		});
		// Only the person who added it can put it back (the database lets only the
		// author insert it), and a retraction is itself an undo.
		const snapshot =
			input.keepForUndo &&
			!input.retract &&
			row?.createdByType === "user" &&
			row.createdById === actor.userId
				? await snapshotShared(tx, actor.userId, input.id)
				: null;
		// Retracting: the service's own notices are dropped, the retraction queued instead.
		await serviceFor(tx, actor.userId, retract ? { notify: [] } : input).delete(
			input.id,
			{
				confirmUnsettled: input.confirmUnsettled ?? false,
				settled: input.settled,
			},
		);
		if (retract) input.notify?.push(() => retractSplitNotices(input.id));
		const stash =
			snapshot && input.settled !== "VOID_PAYMENT"
				? await putUndoStash(tx, actor.userId, snapshot)
				: null;
		return {
			value: { id: input.id, tell, stash },
			undo: {
				kind: "revert",
				mutation: "sharedExpense.create",
				rows: [{ table: "shared_transaction", id: input.id }],
			},
		};
	},
};

export interface RestoreSharedInput extends Deferred {
	readonly stash: string;
}

export interface RestoredShared {
	readonly id: string;
	/** The stamp the restore left, for a client that watches the row. */
	readonly updatedAt: string;
}

/** The undo of sharedExpense.delete: the expense and its shares back as they were stored. */
export const restoreSharedExpense: MoneyMutation<
	RestoreSharedInput,
	RestoredShared
> = {
	id: "sharedExpense.restore",
	touches: SHARED_FIGURES,
	run: async (tx, { notify, stash }, actor) => {
		const snapshot = await takeUndoStash<SharedSnapshot>(
			tx,
			actor.userId,
			stash,
		);
		const restored = await restoreShared(tx, actor.userId, snapshot);
		await logAudit(tx, {
			actor: { participantType: "user", participantId: actor.userId },
			action: "CREATED",
			targetType: "SHARED_TRANSACTION",
			targetId: restored.id,
			changes: serializeTransaction(
				restored as unknown as Record<string, unknown>,
			),
			context: { restoredByUndo: true },
			projectId: restored.projectId ?? undefined,
		});
		notify?.push(() =>
			noticeRestored(restored, actor.userId).catch((err) =>
				console.error("[Notification Error] EXPENSE_SPLIT:", err),
			),
		);
		return {
			value: { id: restored.id, updatedAt: restored.updatedAt.toISOString() },
			undo: {
				kind: "revert",
				mutation: "sharedExpense.delete",
				rows: [{ table: "shared_transaction", id: restored.id }],
			},
		};
	},
};
