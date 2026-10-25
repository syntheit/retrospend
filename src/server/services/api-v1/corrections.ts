import { randomUUID } from "node:crypto";
import type {
	correctExpenseSchema,
	askToFixSchema,
	respondToFixSchema,
	PreviewResult as PreviewDto,
} from "@retrospend/api-contract";
import { MAX_LOCK_STATE_IDS, parseLockStateIds } from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import type * as z from "zod";
import type {
	CorrectResult,
	FixRequestDto,
	FixRequestResult,
	LockStateDto,
} from "~/lib/schemas/corrections";
import {
	type CorrectMutationInput,
	correctSplitMutation,
	undoCorrectionMutation,
} from "~/server/services/corrections/correct.mutation";
import {
	askToFixMutation,
	cancelFixMutation,
	respondToFixMutation,
	restoreFixMutation,
	withdrawFixMutation,
} from "~/server/services/corrections/fix-request.mutation";
import {
	fixRequestsOf,
	lockStatesOf,
} from "~/server/services/corrections/read";
import type { MoneyMutation } from "~/server/services/preview/types";
import type { Caller } from "./caller";
import type { LedgerCaller } from "./money-op";
import { applyWrite, previewWrite, spendUndo, undoFor } from "./money-write";
import { staleAsConflict } from "./stale";
import { readUndo } from "./undo";

/**
 * v1 adapters for corrections and Ask to fix. The mutations are the web's own
 * (services/corrections/*.mutation.ts), so a preview is the dry run of the
 * write the web saves, and each service checks who may do it. The ids a
 * client may choose (the correction, the request) default to a fresh one.
 */

type CorrectBody = z.infer<typeof correctExpenseSchema>;
type AskBody = z.infer<typeof askToFixSchema>;
type RespondBody = z.infer<typeof respondToFixSchema>;
type Notify = (() => Promise<void>)[];

const FAMILY = "correction" as const;

/** Runs the write and tells the people on it once it committed, like the web. */
async function save<I extends { notify?: Notify }, V>(
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

const dryRun = <I extends { notify?: Notify }, V>(
	caller: Caller,
	mutation: MoneyMutation<I, V>,
	input: Omit<I, "notify">,
) => previewWrite(caller, mutation, { ...input, notify: [] } as unknown as I);

// ── Wire shapes ─────────────────────────────────────────────────────────────

function requestOf(r: FixRequestDto) {
	return {
		id: r.id,
		expenseId: r.transactionId,
		requestedBy: r.requestedBy,
		asked: r.asked,
		message: r.message,
		reply: r.reply,
		status: r.status,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
		answeredAt: r.answeredAt,
	};
}

function requestWrite(
	result: FixRequestResult,
	undo: string,
): {
	request: ReturnType<typeof requestOf>;
	previousStatus: FixRequestResult["previousStatus"];
	undo: string;
} {
	return {
		request: requestOf(result.request),
		previousStatus: result.previousStatus,
		undo,
	};
}

function correctionOf(value: CorrectResult, undo: string | null) {
	const money = (minor: number) => ({ minor, currency: value.currency });
	return {
		correctionIds: value.transactionIds,
		currency: value.currency,
		differences: value.differences.map((d) => ({
			person: d.participant,
			paid: money(d.paidMinor),
			share: money(d.shareMinor),
		})),
		resolvedRequests: value.resolvedRequests,
		undo,
	};
}

// ── Correct ─────────────────────────────────────────────────────────────────

function correctInput(
	caller: LedgerCaller,
	body: CorrectBody,
): Omit<CorrectMutationInput, "notify"> {
	return {
		id: body.correctionId ?? randomUUID(),
		transactionId: body.id,
		description: body.description,
		amount: body.amount,
		paidBy: body.paidBy,
		categoryId: body.categoryId,
		splitMode: body.splitMode,
		splitWith: body.splitWith.map((s) => ({
			participant: { type: s.type, id: s.id },
			...(s.shareAmount !== undefined && { shareAmount: s.shareAmount }),
			...(s.sharePercentage !== undefined && {
				sharePercentage: Number(s.sharePercentage),
			}),
			...(s.shareUnits !== undefined && { shareUnits: s.shareUnits }),
		})),
		timeZone: caller.timeZone,
	};
}

export async function correctExpense(caller: LedgerCaller, body: CorrectBody) {
	const value = await save(
		caller,
		correctSplitMutation,
		correctInput(caller, body),
	);
	// Nothing changed: no rows written, so nothing to take back.
	const undo =
		value.transactionIds.length === 0
			? null
			: undoFor(caller, FAMILY, "correction.undo", {
					transactionIds: value.transactionIds,
					resolvedRequests: value.resolvedRequests,
				});
	return correctionOf(value, undo);
}

export const previewCorrectExpense = (caller: LedgerCaller, body: CorrectBody) =>
	dryRun(caller, correctSplitMutation, correctInput(caller, body));

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listFixRequests(caller: Caller, expenseId: string) {
	// Rows the caller cannot see are missing, not empty.
	const visible = await caller.db.sharedTransaction.findUnique({
		where: { id: expenseId },
		select: { id: true },
	});
	if (!visible)
		throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
	const rows = await fixRequestsOf(caller.principal.userId, expenseId);
	return { items: rows.map(requestOf) };
}

export async function readLockStates(caller: Caller, ids: string) {
	const list = parseLockStateIds(ids);
	if (list.length > MAX_LOCK_STATE_IDS)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `At most ${MAX_LOCK_STATE_IDS} ids`,
		});
	const rows: LockStateDto[] = await lockStatesOf(
		caller.principal.userId,
		list,
	);
	return {
		items: rows.map(({ transactionId, ...rest }) => ({
			expenseId: transactionId,
			...rest,
		})),
	};
}

// ── Ask to fix ──────────────────────────────────────────────────────────────

const withdrawToken = (caller: Caller, requestId: string) =>
	undoFor(caller, FAMILY, "fixRequest.withdraw", { id: requestId });

const restoreToken = (
	caller: Caller,
	requestId: string,
	status: "PENDING" | "ACCEPTED",
) => undoFor(caller, FAMILY, "fixRequest.restore", { id: requestId, status });

const askInput = (body: AskBody) => ({
	id: body.requestId ?? randomUUID(),
	transactionId: body.id,
	message: body.message,
});

export async function askToFix(caller: Caller, body: AskBody) {
	const result = await save(caller, askToFixMutation, askInput(body));
	return requestWrite(result, withdrawToken(caller, result.request.id));
}

export const previewAskToFix = (caller: Caller, body: AskBody) =>
	dryRun(caller, askToFixMutation, askInput(body));

const respondInput = (body: RespondBody) => ({
	id: body.id,
	response: body.response,
	reply: body.reply,
});

export async function respondToFix(caller: Caller, body: RespondBody) {
	const result = await save(caller, respondToFixMutation, respondInput(body));
	return requestWrite(result, restoreToken(caller, body.id, "PENDING"));
}

export const previewRespondToFix = (caller: Caller, body: RespondBody) =>
	dryRun(caller, respondToFixMutation, respondInput(body));

export async function cancelFix(caller: Caller, id: string) {
	const result = await applyWrite(caller, cancelFixMutation, { id });
	const was = result.previousStatus === "ACCEPTED" ? "ACCEPTED" : "PENDING";
	return requestWrite(result, restoreToken(caller, id, was));
}

export const previewCancelFix = (caller: Caller, id: string) =>
	previewWrite(caller, cancelFixMutation, { id });

// ── Undo ────────────────────────────────────────────────────────────────────

type Open = {
	preview: () => Promise<PreviewDto>;
	apply: () => Promise<{
		kind: "correction.undo" | "fixRequest.withdraw" | "fixRequest.restore";
		correctionIds?: string[];
		request?: ReturnType<typeof requestOf>;
		redo: null;
	}>;
};

const invalid = () =>
	new TRPCError({
		code: "BAD_REQUEST",
		message: "This undo is not valid anymore",
	});

function open(caller: Caller, op: string, input: unknown): Open {
	if (op === "correction.undo") {
		const args = input as Parameters<typeof undoCorrectionMutation.run>[1];
		return {
			preview: () => previewWrite(caller, undoCorrectionMutation, args),
			apply: async () => {
				const done = await applyWrite(caller, undoCorrectionMutation, args);
				return {
					kind: "correction.undo",
					correctionIds: done.transactionIds,
					redo: null,
				};
			},
		};
	}
	if (op === "fixRequest.withdraw") {
		const args = input as { id: string };
		return {
			preview: () => previewWrite(caller, withdrawFixMutation, args),
			apply: async () => {
				await applyWrite(caller, withdrawFixMutation, args);
				return { kind: "fixRequest.withdraw", redo: null };
			},
		};
	}
	if (op === "fixRequest.restore") {
		const args = input as { id: string; status: "PENDING" | "ACCEPTED" };
		return {
			preview: () => previewWrite(caller, restoreFixMutation, args),
			apply: async () => {
				const done = await applyWrite(caller, restoreFixMutation, args);
				return {
					kind: "fixRequest.restore",
					request: requestOf(done.request),
					redo: null,
				};
			},
		};
	}
	throw invalid();
}

/** Each token works once; the services refuse an undo the state no longer allows. */
export function undoCorrectionWrite(caller: Caller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, FAMILY, token);
	return spendUndo(caller, token, () =>
		staleAsConflict(() => open(caller, op, input).apply()),
	);
}

export function previewUndoCorrectionWrite(caller: Caller, token: string) {
	const { op, input } = readUndo(caller.principal.userId, FAMILY, token);
	return open(caller, op, input).preview();
}
