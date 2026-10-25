/**
 * The undo of an envelope edit (target, create, update, combine, archive,
 * starting money): puts back what the edit stored in envelope_change, never
 * what a client sends. Money the edit moved is taken back with mirror UNDO
 * rows (a batch undoes as one, D28). Only the newest edit of an envelope can
 * be undone, so an undo never overwrites a later change.
 *
 * A created envelope with no money history is deleted; one the edit moved
 * spending through keeps its (zeroed) history and is archived instead,
 * because the movement ledger is append-only and its rows keep the envelope.
 */
import { randomUUID } from "node:crypto";
import type {
	UndoChangeInput,
	UndoChangeResult,
} from "~/lib/schemas/envelope-crud";
import type { Prisma } from "~prisma";
import { restoreLinks, writeAndList } from "./crud-shared";
import {
	type Before,
	loadChange,
	newerChanges,
	parseBefore,
} from "./envelope-change";
import { EnvelopeError } from "./errors";
import { forgetMonthViews } from "./month-read";
import {
	lockedSnapshot,
	type NewMovement,
	type Snapshot,
} from "./movement-state";
import { restoreTarget } from "./target.service";
import { toMinor } from "./units";

type Tx = Prisma.TransactionClient;

/** Mirror rows for the movements an edit wrote (those not undone one by one already). */
async function mirrorRows(
	tx: Tx,
	s: Snapshot,
	movementIds: readonly string[],
	batchId: string,
): Promise<NewMovement[]> {
	const bookId = s.loaded.row.id;
	const originals = await tx.budgetMovement.findMany({
		where: { id: { in: [...movementIds] }, bookId },
	});
	const reverted = new Set(
		(
			await tx.budgetMovement.findMany({
				where: { revertsId: { in: originals.map((o) => o.id) } },
				select: { revertsId: true },
			})
		).map((r) => r.revertsId),
	);
	return originals
		.filter((o) => !reverted.has(o.id))
		.map((o) => ({
			id: randomUUID(),
			// A month that has closed is not rewritten: the money goes back this month.
			month: Math.max(o.month, s.current),
			from: o.toEnvelopeId,
			to: o.fromEnvelopeId,
			minor: toMinor(o.amount.toString(), s.loaded.book.currency),
			kind: "UNDO" as const,
			batchId,
			revertsId: o.id,
		}));
}

async function undoCreate(
	tx: Tx,
	s: Snapshot,
	envelopeId: string,
	b: Before<"CREATE">,
	changeId: string,
) {
	const bookId = s.loaded.row.id;
	const rows = await mirrorRows(tx, s, b.movementIds, changeId);
	const other = await tx.budgetMovement.count({
		where: {
			bookId,
			OR: [{ fromEnvelopeId: envelopeId }, { toEnvelopeId: envelopeId }],
			id: { notIn: b.movementIds },
			kind: { not: "UNDO" },
			// Rows an undo already took back are not history that blocks this one.
			undoneBy: { none: {} },
		},
	});
	if (other > 0)
		throw new EnvelopeError(
			"INVALID",
			"it has money history now: archive it instead",
		);
	await restoreLinks(tx, bookId, b.links);
	// The ledger is append-only and its rows keep their envelope: one that ever had a row is archived.
	const everUsed = await tx.budgetMovement.count({
		where: {
			bookId,
			OR: [{ fromEnvelopeId: envelopeId }, { toEnvelopeId: envelopeId }],
		},
	});
	if (everUsed === 0) {
		try {
			await tx.envelope.delete({ where: { id: envelopeId } });
		} catch (error) {
			if ((error as { code?: string }).code === "P2003")
				throw new EnvelopeError("INVALID", "something uses it now");
			throw error;
		}
	} else
		await tx.envelope.update({
			where: { id: envelopeId },
			data: { archivedAt: new Date() },
		});
	return rows;
}

async function undoUpdate(
	tx: Tx,
	s: Snapshot,
	envelopeId: string,
	name: string | null,
	b: Before<"UPDATE">,
	changeId: string,
) {
	await restoreLinks(tx, s.loaded.row.id, b.links);
	await tx.envelope.update({
		where: { id: envelopeId },
		data: {
			...(name !== null ? { name } : {}),
			...(b.groupId ? { groupId: b.groupId.from } : {}),
			...(b.sortOrder !== null ? { sortOrder: b.sortOrder } : {}),
		},
	});
	return mirrorRows(tx, s, b.movementIds, changeId);
}

async function undoArchive(
	tx: Tx,
	s: Snapshot,
	envelopeId: string,
	b: Before<"ARCHIVE">,
	changeId: string,
) {
	await tx.envelope.update({
		where: { id: envelopeId },
		data: { archivedAt: null },
	});
	await restoreLinks(tx, s.loaded.row.id, b.links);
	await tx.projectParticipant.updateMany({
		where: { id: { in: b.routes } },
		data: { budgetRouting: "ENVELOPE", budgetEnvelopeId: envelopeId },
	});
	await tx.envelopeGroup.updateMany({
		where: { id: { in: b.groupMains } },
		data: { mainEnvelopeId: envelopeId },
	});
	return mirrorRows(tx, s, b.movementIds, changeId);
}

async function undoMerge(
	tx: Tx,
	s: Snapshot,
	intoId: string,
	name: string | null,
	b: Before<"MERGE">,
	changeId: string,
) {
	const bookId = s.loaded.row.id;
	await tx.envelope.updateMany({
		where: { id: { in: b.sources } },
		data: { archivedAt: null },
	});
	await restoreLinks(tx, bookId, b.links);
	for (const r of b.rules)
		await tx.incomeRule.update({
			where: { id: r.id },
			data: { envelopeId: r.from },
		});
	for (const r of b.routes)
		await tx.projectParticipant.update({
			where: { id: r.id },
			data: { budgetEnvelopeId: r.from },
		});
	for (const w of b.sweeps)
		await tx.envelope.update({
			where: { id: w.envelopeId },
			data: { leftoverSweepToId: w.from, leftoverRule: w.rule },
		});
	for (const g of b.groupMains)
		await tx.envelopeGroup.update({
			where: { id: g.groupId },
			data: { mainEnvelopeId: g.from },
		});
	if (b.payoffFrom)
		await tx.payoffPlan.updateMany({
			where: { bookId, envelopeId: intoId },
			data: { envelopeId: b.payoffFrom },
		});
	await restoreTarget(tx, intoId, b);
	if (name !== null)
		await tx.envelope.update({ where: { id: intoId }, data: { name } });
	return mirrorRows(tx, s, b.movementIds, changeId);
}

/** The starting balance row goes, and the answer is open again. */
async function undoStartingMoney(
	tx: Tx,
	bookId: string,
	b: Before<"CONFIRM_STARTING_MONEY">,
) {
	await tx.budgetBook.update({
		where: { id: bookId },
		data: { startingBalanceExpenseId: null, startingMoneyConfirmedAt: null },
	});
	if (b.expenseId) await tx.expense.delete({ where: { id: b.expenseId } });
	forgetMonthViews(tx);
}

export async function undoChange(
	tx: Tx,
	userId: string,
	input: UndoChangeInput,
	now: Date,
): Promise<UndoChangeResult> {
	const s = await lockedSnapshot(tx, userId, now);
	const bookId = s.loaded.row.id;
	const row = await loadChange(tx, bookId, input.id);
	const affected = [row.envelopeId ?? ""];
	if (row.kind === "MERGE")
		affected.push(...parseBefore("MERGE", row.before).sources);
	if (await newerChanges(tx, bookId, row, affected))
		throw new EnvelopeError(
			"INVALID",
			"undo the newer change to this envelope first",
		);
	const envelopeId = row.envelopeId;
	const need = () => {
		if (!envelopeId) throw new EnvelopeError("INVALID", "no envelope to undo");
		return envelopeId;
	};
	let rows: NewMovement[] = [];
	switch (row.kind) {
		case "SET_TARGET":
			await restoreTarget(tx, need(), parseBefore("SET_TARGET", row.before));
			break;
		case "CREATE":
			rows = await undoCreate(
				tx,
				s,
				need(),
				parseBefore("CREATE", row.before),
				row.id,
			);
			break;
		case "UPDATE":
			rows = await undoUpdate(
				tx,
				s,
				need(),
				row.previousName,
				parseBefore("UPDATE", row.before),
				row.id,
			);
			break;
		case "MERGE":
			rows = await undoMerge(
				tx,
				s,
				need(),
				row.previousName,
				parseBefore("MERGE", row.before),
				row.id,
			);
			break;
		case "ARCHIVE":
			rows = await undoArchive(
				tx,
				s,
				need(),
				parseBefore("ARCHIVE", row.before),
				row.id,
			);
			break;
		case "CONFIRM_STARTING_MONEY":
			await undoStartingMoney(
				tx,
				bookId,
				parseBefore("CONFIRM_STARTING_MONEY", row.before),
			);
			break;
	}
	await tx.envelopeChange.update({
		where: { id: row.id },
		data: { undoneAt: now },
	});
	forgetMonthViews(tx);
	const done = await writeAndList(tx, {
		userId,
		now,
		before: s,
		rows,
		touched: rows.flatMap((r) => [r.from, r.to].flatMap((x) => (x ? [x] : []))),
	});
	return {
		...done.moved,
		envelopes: done.left,
		changeId: row.id,
		kind: row.kind,
		envelopeId,
	};
}
