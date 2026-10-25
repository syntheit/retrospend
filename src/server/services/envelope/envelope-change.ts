/**
 * The change log of envelope edits (envelope_change): what each edit changed,
 * kept server side so its undo is exact and a client never sends the old
 * state back. `before` holds ids, amounts and flags only (E2EE rule 10); a
 * name before a rename has its own column. Every log row is written in the
 * edit's transaction, so a preview that rolls back leaves none.
 */
import { z } from "zod";
import { targetSnapshotSchema } from "~/lib/schemas/envelope-book";
import type { Prisma } from "~prisma";
import { EnvelopeError } from "./errors";

type Tx = Prisma.TransactionClient;

const idSchema = z.string().min(1);
const linkSchema = z.object({
	categoryId: idSchema,
	from: idSchema.nullable(),
	to: idSchema.nullable(),
});

/** A row that pointed at an envelope `from` before the edit. */
const fromSchema = z.object({ id: idSchema, from: idSchema });

const kindState = {
	rule: z.enum(["CARRY", "RETURN", "SWEEP"]),
	sweepTo: idSchema.nullable(),
};

/** Links, plus the movement rows an edit wrote (undone as a batch). */
const moved = {
	links: z.array(linkSchema),
	movementIds: z.array(idSchema),
};

export const beforeSchemas = {
	SET_TARGET: z.object({
		target: targetSnapshotSchema,
		leftoverRule: kindState.rule,
		leftoverSweepToId: kindState.sweepTo,
	}),
	CREATE: z.object(moved),
	UPDATE: z.object({
		...moved,
		groupId: z.object({ from: idSchema.nullable() }).nullable(),
		sortOrder: z.number().int().nullable(),
	}),
	MERGE: z.object({
		...moved,
		sources: z.array(idSchema),
		target: targetSnapshotSchema,
		leftoverRule: kindState.rule,
		leftoverSweepToId: kindState.sweepTo,
		rules: z.array(fromSchema),
		routes: z.array(fromSchema),
		sweeps: z.array(
			z.object({
				envelopeId: idSchema,
				from: idSchema,
				rule: kindState.rule,
			}),
		),
		groupMains: z.array(z.object({ groupId: idSchema, from: idSchema })),
		payoffFrom: idSchema.nullable(),
	}),
	ARCHIVE: z.object({
		...moved,
		routes: z.array(idSchema),
		groupMains: z.array(idSchema),
	}),
	CONFIRM_STARTING_MONEY: z.object({
		expenseId: idSchema.nullable(),
	}),
} as const;

export type ChangeKind = keyof typeof beforeSchemas;
export type Before<K extends ChangeKind> = z.infer<(typeof beforeSchemas)[K]>;

/** A client id is used once: a repeat of a finished edit is refused, never written twice. */
export async function assertNewChange(tx: Tx, id: string) {
	const used = await tx.envelopeChange.findUnique({
		where: { id },
		select: { id: true },
	});
	if (used)
		throw new EnvelopeError(
			"ID_REUSED",
			"that id was already used for another change",
		);
}

export async function recordChange<K extends ChangeKind>(
	tx: Tx,
	p: {
		id: string;
		bookId: string;
		userId: string;
		kind: K;
		envelopeId: string | null;
		previousName?: string;
		before: Before<K>;
	},
) {
	await tx.envelopeChange.create({
		data: {
			id: p.id,
			bookId: p.bookId,
			kind: p.kind,
			envelopeId: p.envelopeId,
			previousName: p.previousName ?? null,
			before: p.before as Prisma.InputJsonValue,
			actorUserId: p.userId,
		},
	});
}

/** The stored edit; a missing, foreign or already undone one is refused. */
export async function loadChange(tx: Tx, bookId: string, id: string) {
	const row = await tx.envelopeChange.findFirst({ where: { id, bookId } });
	if (!row) throw new EnvelopeError("NOT_FOUND", "no such change");
	if (row.undoneAt)
		throw new EnvelopeError("ALREADY_UNDONE", "that change was already undone");
	return row;
}

/** What the edit stored, checked against its kind's shape. */
export function parseBefore<K extends ChangeKind>(
	kind: K,
	raw: unknown,
): Before<K> {
	const parsed = beforeSchemas[kind].safeParse(raw);
	if (!parsed.success)
		throw new EnvelopeError("INVALID", "that change cannot be undone");
	return parsed.data as Before<K>;
}

/** The edits whose undo a later edit would make wrong: any newer edit of the same envelope. */
export async function newerChanges(
	tx: Tx,
	bookId: string,
	envelopeIds: readonly string[],
	after: Date,
) {
	return tx.envelopeChange.count({
		where: {
			bookId,
			undoneAt: null,
			createdAt: { gt: after },
			envelopeId: { in: [...envelopeIds] },
		},
	});
}
