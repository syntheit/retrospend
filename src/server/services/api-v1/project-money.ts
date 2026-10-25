import type {
	rebalanceQuerySchema,
	rebalanceSchema,
} from "@retrospend/api-contract";
import type * as z from "zod";
import { toMinor } from "~/server/services/envelope/units";
import { SHARED_FIGURES } from "~/server/services/entry/shared.mutation";
import type { MoneyMutation } from "~/server/services/preview/types";
import { deleteProjectIn } from "~/server/services/project/project-write.service";
import { rebalanceExpenses } from "~/server/services/project/rebalance.mutation";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";
import { isoDay } from "./caller";
import type { LedgerCaller } from "./money-op";
import { applyWrite, previewWrite } from "./money-write";
import { trpcProject } from "./trpc-bridge";

/**
 * v1 adapters for the project writes that move other people's money: the
 * delete and the rebalance. Both are money mutations, so both preview.
 */

type Body<S extends z.ZodType> = z.infer<S>;
type Kind = "user" | "guest" | "shadow";
const bridge = (caller: LedgerCaller) => trpcProject(caller);

/**
 * Deleting a project is a money action: the expenses and payments in it go
 * with it, and the people in it see their balances change. The mutation is the
 * web's delete; the role is checked first, as the web's procedure does.
 */
const deleteProjectMutation: MoneyMutation<{ id: string }, { id: string }> = {
	id: "project.delete",
	touches: SHARED_FIGURES,
	run: async (tx, input, actor) => {
		await deleteProjectIn(tx, actor.userId, input.id);
		return {
			value: { id: input.id },
			// The expenses and payments go with it: nothing to put back.
			undo: { kind: "revert", mutation: "project.delete", rows: [] },
		};
	},
};

const asOwner = (caller: LedgerCaller, id: string) =>
	requireProjectRole(caller.db, id, "user", caller.principal.userId, "ORGANIZER");

export async function deleteProject(caller: LedgerCaller, id: string) {
	await asOwner(caller, id);
	await applyWrite(caller, deleteProjectMutation, { id });
	return { ok: true as const };
}

export async function previewDeleteProject(caller: LedgerCaller, id: string) {
	await asOwner(caller, id);
	return previewWrite(caller, deleteProjectMutation, { id });
}


// ── Rebalance ───────────────────────────────────────────────────────────────

export async function listRebalanceable(
	caller: LedgerCaller,
	query: Body<typeof rebalanceQuerySchema>,
) {
	const rows = await (await bridge(caller)).rebalanceableExpenses({
		projectId: query.id,
		participantType: query.type,
		participantId: query.personId,
	});
	return {
		items: rows.map((r) => ({
			id: r.id,
			title: r.description,
			amount: { minor: toMinor(String(r.amount), r.currency), currency: r.currency },
			date: isoDay(r.date),
			splitMode: r.splitMode,
			eligible: r.eligible,
			currentParticipantCount: r.currentParticipantCount,
			beforeJoin: r.beforeJoin,
			hasAllOtherMembers: r.hasAllOtherMembers,
		})),
	};
}

type RebalanceRun = Body<typeof rebalanceSchema>;
type RebalanceInput = {
	projectId: string;
	participantType: Kind;
	participantId: string;
	expenseIds?: string[];
	timeZone: string;
};

/**
 * The web runs the rebalance inside a transaction without a preview; here it
 * is the money mutation the preview rolls back. Nothing takes it back, so it
 * names no undo rows.
 */
const rebalanceMutation: MoneyMutation<
	RebalanceInput,
	Awaited<ReturnType<typeof rebalanceExpenses>>
> = {
	id: "project.rebalance",
	touches: SHARED_FIGURES,
	run: async (tx, { timeZone, ...input }, actor) => ({
		value: await rebalanceExpenses(
			tx,
			{ userId: actor.userId, timeZone },
			input,
		),
		undo: { kind: "revert", mutation: "project.rebalance", rows: [] },
	}),
};

async function rebalanceInput(
	caller: LedgerCaller,
	body: RebalanceRun,
): Promise<RebalanceInput> {
	await requireProjectRole(
		caller.db,
		body.id,
		"user",
		caller.principal.userId,
		"EDITOR",
	);
	return {
		projectId: body.id,
		participantType: body.person.type,
		participantId: body.person.id,
		expenseIds: body.expenseIds,
		timeZone: caller.timeZone,
	};
}

export async function rebalance(caller: LedgerCaller, body: RebalanceRun) {
	const done = await applyWrite(
		caller,
		rebalanceMutation,
		await rebalanceInput(caller, body),
	);
	return {
		rebalancedCount: done.rebalancedCount,
		rebalancedIds: done.rebalancedIds ?? [],
		skipped: done.skipped,
	};
}

export async function previewRebalance(
	caller: LedgerCaller,
	body: RebalanceRun,
) {
	return previewWrite(
		caller,
		rebalanceMutation,
		await rebalanceInput(caller, body),
	);
}

