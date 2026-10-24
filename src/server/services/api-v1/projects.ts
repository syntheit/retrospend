import type { plannedLineSchema } from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import type * as z from "zod";
import { batchResolveIdentities } from "~/server/services/project/identities";
import { readProjectList } from "~/server/services/project/list-view";
import { membersOn } from "~/server/services/project/membership.service";
import { readProjectPage } from "~/server/services/project/page-view";
import {
	applySettleAll,
	previewSettleAll,
	undoSettleAll,
} from "~/server/services/project/settle-all.service";
import { settleAllInProject } from "~/server/services/project/settle-all.mutation";
import { undoSettleAllInProject } from "~/server/services/project/settle-all-undo.mutation";
import { getProjectSummary } from "~/server/services/project/summary.service";
import { forUser } from "~/server/services/preview";
import { requireProjectRole } from "~/server/services/shared-expenses/project-permissions";
import type { Caller } from "./caller";
import { toPreviewDto, undoFor } from "./money-write";
import { thaw } from "./thaw";
import { readUndo } from "./undo";

/**
 * v1 adapters for /projects: the web's own reads (list-view, page-view,
 * summary, membersOn) and its Settle all mutation. A signed-in member only;
 * the roles are the web's (viewer reads, contributor settles).
 */

type LedgerCaller = Caller & { timeZone: string };
type PlannedLine = z.infer<typeof plannedLineSchema>;

const FAMILY = "project" as const;

type MinimumRole = Parameters<typeof requireProjectRole>[4];

const asMember = (caller: Caller, projectId: string, minimum: MinimumRole) =>
	requireProjectRole(
		caller.db,
		projectId,
		"user",
		caller.principal.userId,
		minimum,
	);

export async function listProjects(caller: Caller) {
	return {
		items: thaw(await readProjectList(caller.db, caller.principal.userId)),
		nextCursor: null,
	};
}

export async function readProject(caller: LedgerCaller, id: string) {
	await asMember(caller, id, "VIEWER");
	return thaw(
		await readProjectPage(
			caller.db,
			id,
			caller.principal.userId,
			caller.timeZone,
		),
	);
}

export async function listMembersOn(
	caller: LedgerCaller,
	id: string,
	date?: string,
) {
	await asMember(caller, id, "VIEWER");
	const rows = await membersOn(
		caller.db,
		id,
		date,
		caller.principal.userId,
		caller.timeZone,
	);
	const people = await batchResolveIdentities(caller.db, rows);
	return {
		items: rows.map((m) => {
			const key = `${m.participantType}:${m.participantId}`;
			return {
				id: key,
				name: people.get(key)?.name ?? "Unknown",
				imageUrl: people.get(key)?.avatarUrl ?? null,
				participantType: m.participantType,
				participantId: m.participantId,
				role: m.role,
				joinedOn: m.joinedOn,
				leftOn: m.leftOn,
			};
		}),
	};
}

type SummaryPerson = {
	participantType: "user" | "guest" | "shadow";
	participantId: string;
	key: string;
	name: string;
	avatarUrl: string | null;
};

const personOf = (p: SummaryPerson) => ({
	type: p.participantType,
	id: p.participantId,
	key: p.key,
	name: p.name,
	imageUrl: p.avatarUrl,
});

export async function readSummary(
	caller: Caller,
	id: string,
	periodId?: string,
) {
	await asMember(caller, id, "VIEWER");
	const summary = await getProjectSummary(
		caller.db,
		id,
		{ participantType: "user", participantId: caller.principal.userId },
		periodId,
	);
	return {
		...thaw(summary),
		members: summary.members.map((m) => ({
			...personOf(m as SummaryPerson),
			isMember: m.isMember,
			role: m.role,
			joinedOn: m.joinedOn,
			leftOn: m.leftOn,
			lines: thaw(m.lines),
		})),
		transfers: summary.transfers.map((t) => ({
			from: personOf(t.from as SummaryPerson),
			to: personOf(t.to as SummaryPerson),
			amount: t.amount,
		})),
	};
}

// ── Settle all ──────────────────────────────────────────────────────────────

export async function readSettleAllPlan(caller: LedgerCaller, id: string) {
	await asMember(caller, id, "CONTRIBUTOR");
	const { value } = await previewSettleAll(
		caller.principal.userId,
		id,
		caller.timeZone,
	);
	return { planned: thaw(value.planned), skipped: thaw(value.skipped) };
}

export async function previewSettleAllWrite(
	caller: LedgerCaller,
	id: string,
	expect?: PlannedLine[],
) {
	await asMember(caller, id, "CONTRIBUTOR");
	return toPreviewDto(
		await forUser(caller.principal.userId).preview(settleAllInProject, {
			projectId: id,
			expect,
			timeZone: caller.timeZone,
		}),
	);
}

/** Records what the person saw (`expect`), or what is open now when none was sent. */
export async function settleAllWrite(
	caller: LedgerCaller,
	id: string,
	expect?: PlannedLine[],
) {
	await asMember(caller, id, "CONTRIBUTOR");
	const seen =
		expect ??
		(
			await previewSettleAll(caller.principal.userId, id, caller.timeZone)
		).value.planned;
	const { value } = await applySettleAll(
		caller.db,
		caller.principal.userId,
		{ projectId: id, expect: seen },
		caller.timeZone,
	);
	return {
		settled: thaw(value.lines),
		skipped: thaw(value.skipped),
		undo: undoFor(caller, FAMILY, "project.settleAllUndo", {
			projectId: id,
			paymentIds: value.lines.map((l) => l.paymentId),
		}),
	};
}

// ── Undo ────────────────────────────────────────────────────────────────────

type UndoInput = { projectId: string; paymentIds: string[] };

/** A token is for one project: another project's id in the path is not valid. */
function undoInputOf(caller: Caller, id: string, token: string): UndoInput {
	const { op, input } = readUndo(caller.principal.userId, FAMILY, token);
	const args = input as UndoInput;
	if (op !== "project.settleAllUndo" || args.projectId !== id) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This undo is not valid anymore",
		});
	}
	return args;
}

export async function undoSettleAllWrite(
	caller: Caller,
	id: string,
	token: string,
) {
	const args = undoInputOf(caller, id, token);
	await asMember(caller, id, "CONTRIBUTOR");
	const { value } = await undoSettleAll(caller.principal.userId, args);
	return { undone: value.undone, redo: null };
}

export async function previewUndoSettleAllWrite(
	caller: Caller,
	id: string,
	token: string,
) {
	const args = undoInputOf(caller, id, token);
	await asMember(caller, id, "CONTRIBUTOR");
	return toPreviewDto(
		await forUser(caller.principal.userId).preview(undoSettleAllInProject, args),
	);
}
