import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { MoneyMutation } from "~/server/services/preview/types";
import type { Prisma } from "~prisma";

/**
 * An undo is only safe against the state its write left behind (the same
 * rule as shared-guard.ts for shared expenses). The engine guards some of its
 * own undos (a movement taken back twice, an envelope edit that is not the
 * newest). The rest are "put the previous value back" writes, and those must
 * refuse when the row changed since: a guard names the row, the write stores
 * its stamp, and the undo runs only while the stamp still reads the same, in
 * the undo's own transaction so a concurrent edit cannot slip in between.
 *
 * Stamps are text read from the row. The book and envelope stamps are the
 * stored undo record, not `updatedAt`: opening the Budget page touches the
 * book row, and that must not spoil an undo.
 */
export type GuardRef =
	| { table: "budgetBook"; id: string }
	| { table: "envelope"; id: string }
	| { table: "splitParticipant"; id: string }
	| { table: "budgetDraft"; id: string }
	| { table: "envelopeGroup"; id: string }
	/** The caller's payoff plan, by the undo record its last save left. */
	| { table: "payoffPlan" }
	| { table: "payment"; id: string }
	| { table: "projectParticipant"; id: string }
	| { table: "expense"; ids: string[] }
	/** An account: its row, balance and how much has been written against it. */
	| { table: "account"; id: string }
	/** The newest period row of the caller's book. */
	| { table: "bookPeriod" };

type Tx = Prisma.TransactionClient;

const GONE = "gone";
const digest = (text: string) =>
	createHash("sha256").update(text).digest("hex").slice(0, 32);

async function stampOfBook(tx: Tx, id: string) {
	const row = await tx.budgetBook.findUnique({
		where: { id },
		select: { styleUndo: true },
	});
	return row ? digest(JSON.stringify(row.styleUndo ?? null)) : GONE;
}

async function stampOfEnvelope(tx: Tx, id: string) {
	const row = await tx.envelope.findUnique({
		where: { id },
		select: { limitUndo: true },
	});
	return row ? digest(JSON.stringify(row.limitUndo ?? null)) : GONE;
}

async function stampOfExpenses(tx: Tx, ids: string[]) {
	const rows = await tx.expense.findMany({
		where: { id: { in: ids } },
		select: { id: true, updatedAt: true },
		orderBy: { id: "asc" },
	});
	return digest(rows.map((r) => `${r.id}:${r.updatedAt.toISOString()}`).join());
}

async function stampOfAccount(tx: Tx, id: string) {
	const row = await tx.assetAccount.findUnique({
		where: { id },
		select: {
			updatedAt: true,
			balance: true,
			closedAt: true,
			exchangeRateType: true,
			_count: { select: { legs: true, snapshots: true, rateTypes: true } },
		},
	});
	if (!row) return GONE;
	return digest(
		[
			row.updatedAt.toISOString(),
			row.balance.toString(),
			row.closedAt?.toISOString() ?? "",
			row.exchangeRateType ?? "",
			row._count.legs,
			row._count.snapshots,
			row._count.rateTypes,
		].join("|"),
	);
}

export async function readStamp(
	tx: Tx,
	userId: string,
	ref: GuardRef,
): Promise<string> {
	const at = (row: { updatedAt: Date } | null) =>
		row ? row.updatedAt.toISOString() : GONE;
	switch (ref.table) {
		case "budgetBook":
			return stampOfBook(tx, ref.id);
		case "envelope":
			return stampOfEnvelope(tx, ref.id);
		case "splitParticipant":
			return at(
				await tx.splitParticipant.findUnique({
					where: { id: ref.id },
					select: { updatedAt: true },
				}),
			);
		case "envelopeGroup":
			return at(
				await tx.envelopeGroup.findUnique({
					where: { id: ref.id },
					select: { updatedAt: true },
				}),
			);
		case "payoffPlan": {
			const row = await tx.payoffPlan.findFirst({
				where: { book: { createdById: userId, isPersonal: true } },
				select: { undo: true },
			});
			return row ? digest(JSON.stringify(row.undo ?? null)) : GONE;
		}
		case "budgetDraft":
			return at(
				await tx.budgetDraft.findUnique({
					where: { id: ref.id },
					select: { updatedAt: true },
				}),
			);
		case "payment":
			return at(
				await tx.payment.findUnique({
					where: { id: ref.id },
					select: { updatedAt: true },
				}),
			);
		case "expense":
			return stampOfExpenses(tx, ref.ids);
		case "account":
			return stampOfAccount(tx, ref.id);
		case "projectParticipant": {
			const row = await tx.projectParticipant.findUnique({
				where: { id: ref.id },
				select: { budgetRouting: true, budgetEnvelopeId: true },
			});
			return row ? `${row.budgetRouting}:${row.budgetEnvelopeId ?? ""}` : GONE;
		}
		case "bookPeriod": {
			const row = await tx.bookPeriod.findFirst({
				where: { book: { createdById: userId, isPersonal: true } },
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				select: { id: true },
			});
			return row?.id ?? GONE;
		}
	}
}

/** An undo that runs only while the row still reads `stamp` (the transaction of the undo itself). */
export function guardedUndo<I, V>(
	mutation: MoneyMutation<I, V>,
	guard: GuardRef | null,
	stamp: string | null,
): MoneyMutation<I, V> {
	if (!guard || stamp === null) return mutation;
	return {
		...mutation,
		run: async (tx, input, actor) => {
			if ((await readStamp(tx, actor.userId, guard)) !== stamp)
				throw new TRPCError({
					code: "CONFLICT",
					message: "This changed since. Undo is no longer safe.",
				});
			return mutation.run(tx, input, actor);
		},
	};
}
