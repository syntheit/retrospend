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
 * - sharedExpense.delete: confirmed with a named button and no undo, since it
 *   changes other people's balances (ADD-EXPENSE-R2: shared delete).
 */
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";
import type { MoneyMutation } from "../preview/types";
import { SharedTransactionService } from "../shared-expenses/transaction.service";
import { RETRACT_WINDOW_MS, retractSplitNotices } from "./notices";

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
}

export const updateSharedExpense: MoneyMutation<
	UpdateSharedInput & Deferred,
	UpdatedShared
> = {
	id: "sharedExpense.update",
	touches: SHARED_FIGURES,
	run: async (tx, { notify, ...input }, actor) => {
		const restore = await restoreOf(tx, input.id);
		await serviceFor(tx, actor.userId, { notify }).update(input);
		return {
			value: { id: input.id, restore },
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

export const deleteSharedExpense: MoneyMutation<
	DeleteSharedInput,
	{ id: string }
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
		// Retracting: the service's own notices are dropped, the retraction queued instead.
		await serviceFor(tx, actor.userId, retract ? { notify: [] } : input).delete(
			input.id,
			{
				confirmUnsettled: input.confirmUnsettled ?? false,
				settled: input.settled,
			},
		);
		if (retract) input.notify?.push(() => retractSplitNotices(input.id));
		return {
			value: { id: input.id },
			undo: {
				kind: "revert",
				mutation: "sharedExpense.create",
				rows: [{ table: "shared_transaction", id: input.id }],
			},
		};
	},
};
