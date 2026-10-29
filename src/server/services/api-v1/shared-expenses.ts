import { randomUUID } from "node:crypto";
import type {
	createSharedExpenseSchema,
	deleteSharedExpenseSchema,
	PreviewResult as PreviewDto,
	updateSharedExpenseSchema,
} from "@retrospend/api-contract";
import { parseDateOnlyIn } from "@retrospend/domain/time-zone";
import { TRPCError } from "@trpc/server";
import type * as z from "zod";
import {
	type CreatedShared,
	type CreateSharedInput,
	createSharedExpense,
	type Deferred,
	deleteSharedExpense,
	type SharedRestore,
	type UpdateSharedInput,
	updateSharedExpense,
} from "~/server/services/entry/shared.mutation";
import { forUser } from "~/server/services/preview";
import type { MoneyMutation } from "~/server/services/preview/types";
import { resolveParticipantNames } from "~/server/services/project/identities";
import {
	answerShareMutation,
	type RestoreAnswerInput,
	restoreAnswerMutation,
} from "~/server/services/shared-expenses/answer-share.mutation";
import {
	type RestoreSelfInput,
	restoreSelfMutation,
} from "~/server/services/shared-expenses/remove-self.mutation";
import { exactAmount } from "./amounts";
import type { Caller } from "./caller";
import { moneyOf } from "./caller";
import {
	applyWrite,
	previewWrite,
	spendUndo,
	toPreviewDto,
	undoFor,
} from "./money-write";
import { guardedShared } from "./shared-guard";
import { type ShareChange, withShares } from "./shared-shares";
import { readUndo } from "./undo";

/**
 * v1 adapters for /shared-expenses. The mutations are the web's own
 * (entry/shared.mutation.ts), so a preview here is the dry run of the same
 * write the web saves. Amounts come in as decimal text and reach the split
 * service as the number it takes today, the way the web form sends them.
 */

type LedgerCaller = Caller & { timeZone: string };
type CreateBody = z.infer<typeof createSharedExpenseSchema>;
type UpdateBody = z.infer<typeof updateSharedExpenseSchema>;
type DeleteBody = z.infer<typeof deleteSharedExpenseSchema>;
type Notify = (() => Promise<void>)[];

const FAMILY = "shared" as const;
const RESTORE_ANSWER = "shared.restoreAnswer";

const refOf = (p: { type: "user" | "guest" | "shadow"; id: string }) => ({
	participantType: p.type,
	participantId: p.id,
});

function splitOf(body: CreateBody | UpdateBody) {
	return (body.splitWith ?? []).map((s) => ({
		...refOf(s),
		...(s.shareAmount !== undefined && {
			shareAmount: exactAmount(s.shareAmount, body.currency, "shareAmount"),
		}),
		...(s.sharePercentage !== undefined && {
			sharePercentage: Number(s.sharePercentage),
		}),
		...(s.shareUnits !== undefined && { shareUnits: s.shareUnits }),
	}));
}

function createInput(
	caller: LedgerCaller,
	body: CreateBody,
): CreateSharedInput {
	return {
		id: body.id,
		amount: exactAmount(body.amount, body.currency),
		currency: body.currency,
		description: body.description,
		categoryId: body.categoryId,
		date: parseDateOnlyIn(body.date, caller.timeZone),
		paidBy: refOf(body.paidBy),
		splitWith: splitOf(body),
		splitMode: body.splitMode,
		projectId: body.projectId ?? undefined,
		notes: body.notes ?? undefined,
	};
}

function updateInput(
	caller: LedgerCaller,
	body: UpdateBody,
): UpdateSharedInput {
	return {
		id: body.id,
		amount: exactAmount(body.amount, body.currency),
		currency: body.currency,
		description: body.description,
		categoryId: body.categoryId ?? null,
		date: parseDateOnlyIn(body.date, caller.timeZone),
		paidBy: refOf(body.paidBy),
		// Left out: the service keeps the people and splits a new amount again.
		...(body.splitWith ? { splitWith: splitOf(body) } : {}),
		splitMode: body.splitMode,
		projectId: body.projectId ?? null,
		notes: body.notes ?? null,
	};
}

/** Runs the write and tells the people on it once it committed, like the web. */
async function save<I extends Deferred, V>(
	caller: Caller,
	mutation: MoneyMutation<I, V>,
	input: Omit<I, "notify">,
): Promise<V> {
	const notify: Notify = [];
	const value = await applyWrite(caller, mutation, {
		...input,
		notify,
	} as unknown as I);
	for (const send of notify) void send();
	return value;
}

const dryRun = <I extends Deferred, V>(
	caller: Caller,
	mutation: MoneyMutation<I, V>,
	input: Omit<I, "notify">,
) => previewWrite(caller, mutation, { ...input, notify: [] } as unknown as I);

export async function addSharedExpense(caller: LedgerCaller, body: CreateBody) {
	const value = await save(
		caller,
		guardedShared(createSharedExpense),
		createInput(caller, body),
	);
	return {
		id: value.id,
		backdatedPeriod: value.backdatedPeriod,
		// Undoing right away is a retraction, like the web's: the debt it made goes
		// with it (confirmUnsettled) and the people on it see nothing happen. It
		// runs only while the expense is as this write left it.
		undo: undoFor(caller, FAMILY, "shared.delete", {
			id: value.id,
			confirmUnsettled: true,
			retract: true,
			expectedUpdatedAt: value.updatedAt ?? undefined,
		}),
	};
}

/**
 * The dry run of an add. Its detail names each person's share as the server
 * splits it, so a client shows the split without computing it.
 */
export async function previewAddSharedExpense(
	caller: LedgerCaller,
	body: CreateBody,
) {
	// The shares are read back by id, so a dry run without one gets its own.
	const add: MoneyMutation<
		CreateSharedInput & Deferred & { id: string },
		CreatedShared
	> = createSharedExpense;
	const input = createInput(caller, body);
	const preview = await forUser(caller.principal.userId).preview(
		withShares(add),
		{ ...input, id: input.id ?? randomUUID(), notify: [] },
	);
	return {
		...toPreviewDto(preview),
		detail: {
			kind: "sharedExpense.create" as const,
			shares: await sharesView(caller, preview.value.shares),
		},
	};
}

/**
 * Left out, the split keeps its people and its mode: a new mode needs the
 * shares it counts (amounts, percents or units), so it comes with splitWith.
 */
async function requireSplitForNewMode(caller: Caller, body: UpdateBody) {
	if (body.splitWith) return;
	const row = await caller.db.sharedTransaction.findUnique({
		where: { id: body.id },
		select: { splitMode: true },
	});
	if (row && row.splitMode !== body.splitMode)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				"To change splitMode, send splitWith with each person's share in the new mode.",
		});
}

export async function replaceSharedExpense(
	caller: LedgerCaller,
	body: UpdateBody,
) {
	await requireSplitForNewMode(caller, body);
	const value = await save(
		caller,
		guardedShared(updateSharedExpense),
		updateInput(caller, body),
	);
	return {
		id: value.id,
		backdatedPeriod: null,
		undo: undoFor(caller, FAMILY, "shared.update", {
			restore: value.restore,
			expectedUpdatedAt: value.updatedAt ?? undefined,
		}),
	};
}

/**
 * The dry run of an edit. Its detail names what each person owes before and
 * after, from the same run as the figures, so a client can say whose share
 * moves (an amount change on a custom split moves every share).
 */
export async function previewReplaceSharedExpense(
	caller: LedgerCaller,
	body: UpdateBody,
) {
	await requireSplitForNewMode(caller, body);
	const preview = await forUser(caller.principal.userId).preview(
		withShares(updateSharedExpense),
		{ ...updateInput(caller, body), notify: [] },
	);
	return {
		...toPreviewDto(preview),
		detail: {
			kind: "sharedExpense.update" as const,
			shares: await sharesView(caller, preview.value.shares),
		},
	};
}

const deleteInput = (body: DeleteBody) => ({
	id: body.id,
	confirmUnsettled: body.confirmUnsettled,
	settled: body.settled,
});

export async function removeSharedExpense(caller: Caller, body: DeleteBody) {
	const value = await save(caller, deleteSharedExpense, deleteInput(body));
	return { id: value.id };
}

export const previewRemoveSharedExpense = (caller: Caller, body: DeleteBody) =>
	dryRun(caller, deleteSharedExpense, deleteInput(body));

/** Each person's share before and after, with their name; `you` marks the caller. */
async function sharesView(caller: Caller, shares: readonly ShareChange[]) {
	const named = await resolveParticipantNames(
		caller.db,
		shares.map((s) => ({
			participantType: s.participantType,
			participantId: s.participantId,
		})),
	);
	return shares.map((s, i) => ({
		type: s.participantType,
		id: s.participantId,
		name: named[i]?.name ?? "",
		you:
			s.participantType === "user" &&
			s.participantId === caller.principal.userId,
		before: s.before ? moneyOf(s.before.amount, s.before.currency) : null,
		after: s.after ? moneyOf(s.after.amount, s.after.currency) : null,
	}));
}

// ── Undo ────────────────────────────────────────────────────────────────────

const invalidUndo = () =>
	new TRPCError({
		code: "BAD_REQUEST",
		message: "This undo is not valid anymore",
	});

/** A restore as the token carries it (JSON turns its date into text). */
type StoredRestore = Omit<SharedRestore, "date"> & { date: string };

type Stamped = { expectedUpdatedAt?: string };

function restoreOf(stored: StoredRestore): UpdateSharedInput {
	return { ...stored, date: new Date(stored.date) };
}

type Inverse = {
	preview: () => Promise<PreviewDto>;
	apply: () => Promise<{ id: string; redo: string | null }>;
};

/**
 * The inverse call a token names, ready to preview or to apply. It runs only
 * while the expense is as the write the token came from left it, so an old
 * token can never put old values over a newer edit.
 */
function inverseOf(caller: Caller, op: string, input: unknown): Inverse {
	if (op === "shared.delete") {
		const { expectedUpdatedAt, ...args } = input as {
			id: string;
			confirmUnsettled?: boolean;
			retract?: boolean;
		} & Stamped;
		const mutation = guardedShared(deleteSharedExpense, expectedUpdatedAt);
		return {
			preview: () => dryRun(caller, mutation, args),
			apply: async () => {
				const value = await save(caller, mutation, args);
				return { id: value.id, redo: null };
			},
		};
	}
	if (op === "shared.update") {
		const { restore, expectedUpdatedAt } = input as {
			restore: StoredRestore;
		} & Stamped;
		const args = restoreOf(restore);
		const mutation = guardedShared(updateSharedExpense, expectedUpdatedAt);
		return {
			preview: () => dryRun(caller, mutation, args),
			apply: async () => {
				const value = await save(caller, mutation, args);
				return {
					id: value.id,
					redo: undoFor(caller, FAMILY, "shared.update", {
						restore: value.restore,
						expectedUpdatedAt: value.updatedAt ?? undefined,
					}),
				};
			},
		};
	}
	if (op === RESTORE_ANSWER) {
		const args = input as RestoreAnswerInput;
		return {
			preview: () => previewWrite(caller, restoreAnswerMutation, args),
			apply: async () => {
				const done = await applyWrite(caller, restoreAnswerMutation, args);
				return { id: done.transactionId, redo: null };
			},
		};
	}
	if (op === "shared.restoreSelf") {
		const args = input as RestoreSelfInput;
		return {
			preview: () => previewWrite(caller, restoreSelfMutation, args),
			apply: async () => {
				const done = await applyWrite(caller, restoreSelfMutation, args);
				return { id: done.transactionId, redo: null };
			},
		};
	}
	throw invalidUndo();
}

/** Each token works once, and only against the state it left. */
export function undoSharedExpenseWrite(caller: Caller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, FAMILY, token);
	return spendUndo(caller, token, () => inverseOf(caller, op, input).apply());
}

export function previewUndoSharedExpenseWrite(caller: Caller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, FAMILY, token);
	return inverseOf(caller, op, input).preview();
}

// ── Accept and reject ───────────────────────────────────────────────────────

const answerInput = (
	id: string,
	answer: "accept" | "reject",
	reason?: string,
) => ({ transactionId: id, answer, reason });

/** The answer as the contract shows it, with the token that takes it back. */
async function answerOf(
	caller: Caller,
	id: string,
	answer: "accept" | "reject",
	reason?: string,
) {
	const done = await applyWrite(
		caller,
		answerShareMutation,
		answerInput(id, answer, reason),
	);
	return {
		id: done.transactionId,
		status: done.status,
		participants: [...done.participants],
		undo: undoFor(caller, FAMILY, RESTORE_ANSWER, {
			transactionId: done.transactionId,
			answer,
			was: done.was,
		} satisfies RestoreAnswerInput),
	};
}

export const acceptSharedExpense = (caller: Caller, id: string) =>
	answerOf(caller, id, "accept");

export const rejectSharedExpense = (
	caller: Caller,
	id: string,
	reason?: string,
) => answerOf(caller, id, "reject", reason);

export const previewAcceptSharedExpense = (caller: Caller, id: string) =>
	previewWrite(caller, answerShareMutation, answerInput(id, "accept"));

export const previewRejectSharedExpense = (
	caller: Caller,
	id: string,
	reason?: string,
) =>
	previewWrite(caller, answerShareMutation, answerInput(id, "reject", reason));
