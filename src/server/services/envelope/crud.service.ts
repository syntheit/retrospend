/**
 * Add and edit an envelope (SPEC §3, §5.4; the kit's "Add envelope" sheet):
 *
 * - createEnvelope: a name, a group, what it is for, an optional target and
 *   the categories it covers. A category lives in one envelope, so it moves
 *   here from where it was, and from today: this month's spending in it moves
 *   with the money that paid for it, so no envelope's Left changes. Closed
 *   months keep the routing they closed with (B7).
 * - updateEnvelope: rename, move to another group, change the categories.
 *
 * Both run on the caller's transaction so the `*.mutation.ts` wrappers
 * preview them, and both log what they changed (envelope_change) for an exact
 * undo.
 */
import type {
	CreateEnvelopeInput,
	CreateEnvelopeResult,
	UpdateEnvelopeInput,
	UpdateEnvelopeResult,
} from "~/lib/schemas/envelope-crud";
import type { Prisma } from "~prisma";
import { leftoverDefault } from "./book.service";
import {
	begin,
	checkCategories,
	moveLinks,
	neutralRows,
	writeAndList,
} from "./crud-shared";
import { assertNewChange, recordChange } from "./envelope-change";
import { EnvelopeError } from "./errors";
import { forgetMonthViews } from "./month-read";
import { checkEnvelope, type Snapshot, snapshot } from "./movement-state";
import { checkTarget, targetColumns } from "./target-write";

type Tx = Prisma.TransactionClient;

function checkGroup(s: Snapshot, groupId: string | null | undefined) {
	if (groupId && !s.loaded.row.groups.some((g) => g.id === groupId))
		throw new EnvelopeError("NOT_FOUND", "no such group");
}

const nextOrder = (s: Snapshot) =>
	s.loaded.row.envelopes.reduce((m, e) => Math.max(m, e.sortOrder), -1) + 1;

/** The edit's money rows and the lines it lists, after the links have moved. */
async function finish(
	tx: Tx,
	p: {
		userId: string;
		now: Date;
		before: Snapshot;
		changeId: string;
		kind: "MOVE";
		touched: string[];
	},
) {
	const after = await snapshot(tx, p.userId, p.now);
	const rows = neutralRows(p.before, after, p.changeId, p.kind);
	const out = await writeAndList(tx, {
		userId: p.userId,
		now: p.now,
		before: p.before,
		rows,
		touched: p.touched,
	});
	return { ...out, rows };
}

export async function createEnvelope(
	tx: Tx,
	userId: string,
	input: CreateEnvelopeInput,
	now: Date,
): Promise<CreateEnvelopeResult> {
	const s = await begin(tx, userId, now);
	const book = s.loaded.row;
	const H = s.loaded.book.currency;
	checkGroup(s, input.groupId);
	await checkCategories(tx, input.categoryIds);
	await checkTarget(tx, input.kind, input.target);
	await assertNewChange(tx, input.id);
	await tx.envelope.create({
		data: {
			id: input.id,
			bookId: book.id,
			groupId: input.groupId,
			name: input.name,
			icon: input.icon ?? null,
			kind: input.kind,
			leftoverRule: leftoverDefault(book.style),
			sortOrder: nextOrder(s),
			...targetColumns(input.target, H, s.current),
		},
	});
	const routed = await moveLinks(
		tx,
		s,
		new Map(input.categoryIds.map((c) => [c, input.id])),
	);
	const done = await finish(tx, {
		userId,
		now,
		before: s,
		changeId: input.id,
		kind: "MOVE",
		touched: [input.id, ...routed.flatMap((r) => (r.from ? [r.from] : []))],
	});
	await recordChange(tx, {
		id: input.id,
		bookId: book.id,
		userId,
		kind: "CREATE",
		envelopeId: input.id,
		before: { links: routed, movementIds: done.rows.map((r) => r.id) },
	});
	return {
		...done.moved,
		changeId: input.id,
		envelopeId: input.id,
		routed,
		left: done.left,
	};
}

/** Which categories change owner when `envelopeId` is to cover exactly `wanted`. */
function linkTargets(
	s: Snapshot,
	envelopeId: string,
	wanted: readonly string[],
): Map<string, string | null> {
	const own = s.loaded.row.envelopes
		.find((e) => e.id === envelopeId)
		?.categories.map((c) => c.categoryId);
	const to = new Map<string, string | null>();
	for (const c of own ?? []) if (!wanted.includes(c)) to.set(c, null);
	for (const c of wanted) to.set(c, envelopeId);
	return to;
}

export async function updateEnvelope(
	tx: Tx,
	userId: string,
	input: UpdateEnvelopeInput,
	now: Date,
): Promise<UpdateEnvelopeResult> {
	const s = await begin(tx, userId, now);
	checkEnvelope(input.envelopeId, s);
	const env = s.loaded.row.envelopes.find((e) => e.id === input.envelopeId);
	if (!env) throw new EnvelopeError("NOT_FOUND", "no such envelope");
	const regroup = input.groupId !== undefined && input.groupId !== env.groupId;
	const rename = input.name !== undefined && input.name !== env.name;
	if (input.groupId !== undefined) checkGroup(s, input.groupId);
	if (input.categoryIds) await checkCategories(tx, input.categoryIds);
	await assertNewChange(tx, input.id);
	if (rename || regroup)
		await tx.envelope.update({
			where: { id: env.id },
			data: {
				...(rename ? { name: input.name } : {}),
				...(regroup ? { groupId: input.groupId, sortOrder: nextOrder(s) } : {}),
			},
		});
	const routed = input.categoryIds
		? await moveLinks(tx, s, linkTargets(s, env.id, input.categoryIds))
		: [];
	const done = await finish(tx, {
		userId,
		now,
		before: s,
		changeId: input.id,
		kind: "MOVE",
		touched: [
			env.id,
			s.loaded.row.defaultEnvelopeId as string,
			...routed.flatMap((r) => [r.from, r.to].flatMap((x) => (x ? [x] : []))),
		],
	});
	await recordChange(tx, {
		id: input.id,
		bookId: s.loaded.row.id,
		userId,
		kind: "UPDATE",
		envelopeId: env.id,
		previousName: rename ? env.name : undefined,
		before: {
			links: routed,
			movementIds: done.rows.map((r) => r.id),
			groupId: regroup ? { from: env.groupId } : null,
			sortOrder: regroup ? env.sortOrder : null,
		},
	});
	forgetMonthViews(tx);
	return {
		...done.moved,
		changeId: input.id,
		envelopeId: env.id,
		routed,
		renamed: rename ? { from: env.name, to: input.name as string } : null,
		group: regroup
			? { from: env.groupId, to: input.groupId as string | null }
			: null,
		left: done.left,
	};
}
