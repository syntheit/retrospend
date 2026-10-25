/**
 * Archive an envelope and combine envelopes (SPEC §5.13 history, D65; the
 * kit's "Combine envelopes" sheet):
 *
 * - archiveEnvelope: its Left goes to To assign (kind ARCHIVE) and its
 *   categories fall to Everything else, from today. This month's spending in
 *   them moves with the money that paid for it, so no other envelope's Left
 *   changes. Past months keep the routing they closed with (B7). Everything
 *   else cannot be archived. An overspent envelope is covered first.
 * - mergeEnvelopes: one or more envelopes go into another. Money, categories,
 *   income rules, project routing, sweeps and targets move to the one that
 *   stays; the others are archived with their history. Monthly targets of the
 *   same kind add up; what cannot be carried is counted in the result.
 *
 * Money moves as ARCHIVE rows between current-month Lefts (and next month's
 * assigned money), so ToAssign + ΣLeft + Assigned(next) never changes
 * (SPEC §5.3). Runs on the caller's transaction (preview = result).
 */
import { randomUUID } from "node:crypto";
import type {
	ArchiveEnvelopeInput,
	ArchiveEnvelopeResult,
	MergeEnvelopesInput,
	MergeEnvelopesResult,
} from "~/lib/schemas/envelope-crud";
import { Prisma } from "~prisma";
import { addMonths } from "./calendar";
import { mergeTargets } from "./crud-math";
import { begin, moveLinks, neutralRows, writeAndList } from "./crud-shared";
import { assertNewChange, recordChange } from "./envelope-change";
import { EnvelopeError } from "./errors";
import { restoreData, snapshotOf } from "./limit-target";
import { forgetMonthViews } from "./month-read";
import {
	checkEnvelope,
	type NewMovement,
	type Snapshot,
	snapshot,
} from "./movement-state";

type Tx = Prisma.TransactionClient;

function envelopeOf(s: Snapshot, id: string) {
	const e = s.loaded.row.envelopes.find((x) => x.id === id);
	if (!e) throw new EnvelopeError("NOT_FOUND", "no such envelope");
	return e;
}

const row = (
	c: number,
	from: string | null,
	to: string | null,
	minor: number,
	batchId: string,
): NewMovement => ({
	id: randomUUID(),
	month: c,
	from,
	to,
	minor,
	kind: "ARCHIVE",
	batchId,
});

const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);

export async function archiveEnvelope(
	tx: Tx,
	userId: string,
	input: ArchiveEnvelopeInput,
	now: Date,
): Promise<ArchiveEnvelopeResult> {
	const s = await begin(tx, userId, now);
	const book = s.loaded.row;
	checkEnvelope(input.envelopeId, s);
	const env = envelopeOf(s, input.envelopeId);
	if (env.id === book.defaultEnvelopeId)
		throw new EnvelopeError(
			"INVALID",
			"Everything else is renamable, not archivable",
		);
	if (env.wealthAccountId)
		throw new EnvelopeError("INVALID", "unlink its Wealth account first");
	const payoff = await tx.payoffPlan.findFirst({
		where: { bookId: book.id, envelopeId: env.id },
		select: { id: true },
	});
	if (payoff)
		throw new EnvelopeError("INVALID", "your payoff plan uses this envelope");
	const c = s.current;
	const held = s.left(env.id, c);
	if (held < 0)
		throw new EnvelopeError("INVALID", "cover its overspending first");
	await assertNewChange(tx, input.id);
	const routed = await moveLinks(
		tx,
		s,
		new Map(env.categories.map((x) => [x.categoryId, null])),
	);
	const routes = await tx.projectParticipant.findMany({
		where: {
			participantType: "user",
			participantId: userId,
			budgetEnvelopeId: env.id,
		},
		select: { id: true, projectId: true },
	});
	await tx.projectParticipant.updateMany({
		where: { id: { in: ids(routes) } },
		data: { budgetRouting: "CATEGORY", budgetEnvelopeId: null },
	});
	const mains = await tx.envelopeGroup.findMany({
		where: { bookId: book.id, mainEnvelopeId: env.id },
		select: { id: true },
	});
	await tx.envelopeGroup.updateMany({
		where: { id: { in: ids(mains) } },
		data: { mainEnvelopeId: null },
	});
	const rules = await tx.incomeRule.findMany({
		where: {
			bookId: book.id,
			envelopeId: env.id,
			active: true,
			archivedAt: null,
		},
		select: { id: true },
	});
	await tx.envelope.update({
		where: { id: env.id },
		data: { archivedAt: now },
	});
	forgetMonthViews(tx);
	const after = await snapshot(tx, userId, now);
	const rows = neutralRows(s, after, input.id, "ARCHIVE");
	if (held > 0) rows.push(row(c, env.id, null, held, input.id));
	const ahead = s.assigned(env.id, addMonths(c, 1));
	if (ahead > 0) rows.push(row(addMonths(c, 1), env.id, null, ahead, input.id));
	const done = await writeAndList(tx, {
		userId,
		now,
		before: s,
		rows,
		touched: [
			env.id,
			book.defaultEnvelopeId as string,
			...rows.flatMap((r) => [r.from, r.to].flatMap((x) => (x ? [x] : []))),
		],
	});
	await recordChange(tx, {
		id: input.id,
		bookId: book.id,
		userId,
		kind: "ARCHIVE",
		envelopeId: env.id,
		before: {
			links: routed,
			movementIds: ids(rows),
			routes: ids(routes),
			groupMains: ids(mains),
		},
	});
	return {
		...done.moved,
		changeId: input.id,
		envelopeId: env.id,
		routed,
		left: done.left,
		rulesLeftOut: ids(rules),
		projectRoutes: routes.map((r) => r.projectId),
	};
}

/** Income rules, project routing, sweeps, group mains and the payoff plan that named a combined envelope, now naming the one that stays. */
async function repoint(
	tx: Tx,
	s: Snapshot,
	userId: string,
	intoId: string,
	fromIds: string[],
) {
	const bookId = s.loaded.row.id;
	const rules = await tx.incomeRule.findMany({
		where: { bookId, envelopeId: { in: fromIds } },
		select: { id: true, envelopeId: true },
	});
	await tx.incomeRule.updateMany({
		where: { id: { in: ids(rules) } },
		data: { envelopeId: intoId },
	});
	const routes = await tx.projectParticipant.findMany({
		where: {
			participantType: "user",
			participantId: userId,
			budgetEnvelopeId: { in: fromIds },
		},
		select: { id: true, projectId: true, budgetEnvelopeId: true },
	});
	await tx.projectParticipant.updateMany({
		where: { id: { in: ids(routes) } },
		data: { budgetEnvelopeId: intoId },
	});
	const swept = await tx.envelope.findMany({
		where: { bookId, leftoverSweepToId: { in: fromIds } },
		select: { id: true, leftoverSweepToId: true, leftoverRule: true },
	});
	const sweeps = [];
	for (const e of swept) {
		// The stayer cannot sweep to itself: it keeps what it holds.
		await tx.envelope.update({
			where: { id: e.id },
			data:
				e.id === intoId
					? { leftoverRule: "CARRY", leftoverSweepToId: null }
					: { leftoverSweepToId: intoId },
		});
		sweeps.push({
			envelopeId: e.id,
			from: e.leftoverSweepToId as string,
			rule: e.leftoverRule,
		});
	}
	const into = envelopeOf(s, intoId);
	const mains = await tx.envelopeGroup.findMany({
		where: { bookId, mainEnvelopeId: { in: fromIds } },
		select: { id: true, mainEnvelopeId: true },
	});
	for (const g of mains)
		await tx.envelopeGroup.update({
			where: { id: g.id },
			data: { mainEnvelopeId: into.groupId === g.id ? intoId : null },
		});
	const payoff = await tx.payoffPlan.findFirst({
		where: { bookId, envelopeId: { in: fromIds } },
		select: { id: true, envelopeId: true },
	});
	if (payoff)
		await tx.payoffPlan.update({
			where: { id: payoff.id },
			data: { envelopeId: intoId },
		});
	return {
		rules: rules.map((r) => ({ id: r.id, from: r.envelopeId })),
		routes: routes.map((r) => ({
			id: r.id,
			from: r.budgetEnvelopeId as string,
			projectId: r.projectId,
		})),
		sweeps,
		groupMains: mains.map((g) => ({
			groupId: g.id,
			from: g.mainEnvelopeId as string,
		})),
		payoffFrom: payoff?.envelopeId ?? null,
	};
}

/** Money between a combined envelope and the stayer: what it holds now, and next month's assigned money. */
function mergeRows(
	s: Snapshot,
	after: Snapshot,
	intoId: string,
	fromIds: string[],
	batchId: string,
) {
	const c = s.current;
	const next = addMonths(c, 1);
	const rows: NewMovement[] = [];
	const between = (month: number, from: string, minor: number) => {
		if (minor > 0) rows.push(row(month, from, intoId, minor, batchId));
		else if (minor < 0) rows.push(row(month, intoId, from, -minor, batchId));
	};
	for (const id of fromIds) {
		between(c, id, after.left(id, c));
		between(next, id, after.assigned(id, next));
	}
	return rows;
}

export async function mergeEnvelopes(
	tx: Tx,
	userId: string,
	input: MergeEnvelopesInput,
	now: Date,
): Promise<MergeEnvelopesResult> {
	const s = await begin(tx, userId, now);
	const book = s.loaded.row;
	for (const id of [input.intoId, ...input.fromIds]) checkEnvelope(id, s);
	const into = envelopeOf(s, input.intoId);
	const sources = input.fromIds.map((id) => envelopeOf(s, id));
	for (const e of sources) {
		if (e.id === book.defaultEnvelopeId)
			throw new EnvelopeError(
				"INVALID",
				"Everything else stays: combine the others into it",
			);
		if (e.wealthAccountId)
			throw new EnvelopeError("INVALID", "unlink its Wealth account first");
	}
	await assertNewChange(tx, input.id);
	const routed = await moveLinks(
		tx,
		s,
		new Map(
			sources.flatMap((e) => e.categories.map((x) => [x.categoryId, into.id])),
		),
	);
	const moved = await repoint(tx, s, userId, into.id, input.fromIds);
	const before = snapshotOf(into);
	const merged = mergeTargets(
		before,
		sources.map(snapshotOf),
		into.id === book.defaultEnvelopeId,
	);
	const targetChanged = merged.target !== before;
	await tx.envelope.update({
		where: { id: into.id },
		data: {
			...(targetChanged
				? { ...restoreData(merged.target), limitUndo: Prisma.DbNull }
				: {}),
			...(input.name !== undefined ? { name: input.name } : {}),
		},
	});
	await tx.envelope.updateMany({
		where: { id: { in: input.fromIds } },
		data: { archivedAt: now },
	});
	forgetMonthViews(tx);
	const after = await snapshot(tx, userId, now);
	const rows = mergeRows(s, after, into.id, input.fromIds, input.id);
	const done = await writeAndList(tx, {
		userId,
		now,
		before: s,
		rows,
		touched: [into.id, ...input.fromIds],
	});
	await recordChange(tx, {
		id: input.id,
		bookId: book.id,
		userId,
		kind: "MERGE",
		envelopeId: into.id,
		previousName: input.name !== undefined ? into.name : undefined,
		before: {
			links: routed,
			movementIds: ids(rows),
			sources: input.fromIds,
			target: before,
			leftoverRule: into.leftoverRule,
			leftoverSweepToId: into.leftoverSweepToId,
			rules: moved.rules,
			routes: moved.routes.map(({ id, from }) => ({ id, from })),
			sweeps: moved.sweeps,
			groupMains: moved.groupMains,
			payoffFrom: moved.payoffFrom,
		},
	});
	return {
		...done.moved,
		changeId: input.id,
		intoId: into.id,
		fromIds: input.fromIds,
		routed,
		renamed:
			input.name !== undefined ? { from: into.name, to: input.name } : null,
		left: done.left,
		rules: ids(moved.rules),
		projectRoutes: moved.routes.map((r) => r.projectId),
		sweeps: moved.sweeps.map((x) => x.envelopeId),
		groupMains: moved.groupMains.map((g) => g.groupId),
		payoffPlan: moved.payoffFrom !== null,
		target: {
			before,
			after: merged.target,
			summed: merged.summed,
			dropped: merged.dropped,
		},
	};
}
