/**
 * What a transfer's delete took away besides the move itself, kept as stored
 * so its undo puts back exactly that and recomputes nothing: the budget's side
 * of it (a debt payment's principal leaves an envelope, whatever today's
 * "part of my budget" says) and its fee expense as the user left it (category,
 * envelope, the NOT_SPENDING mark, day). The plain recreate writes the move,
 * its legs and a fresh fee; this then replaces the side and the fee's fields.
 *
 * The stash rides the delete's undo token as `restore`. A token without one
 * replays as a plain recreate; one whose shape is unknown is refused. Row
 * shapes are the account delete's (accounts/delete-snapshot.ts, entry/row-pack.ts).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Prisma } from "~prisma";
import { packRow, type Row, unpackRow } from "../entry/row-pack";
import { forgetMonthViews } from "../envelope/month-read";

type Tx = Prisma.TransactionClient;

const text = z.string().min(1).max(64);
const date = z.object({ $date: z.iso.datetime() }).strict();
const dec = z.object({ $dec: z.string().regex(/^-?\d+(\.\d+)?$/) }).strict();

/** A wealth_transfer row whole, as packRow keeps it. */
const sideSchema = z
	.object({
		id: text,
		bookId: text,
		direction: z.enum(["TO_WEALTH", "FROM_WEALTH"]),
		envelopeId: text.nullable(),
		transferId: text,
		sourceExpenseId: z.null(),
		assetAccountId: text.nullable(),
		countOnly: z.boolean(),
		date,
		amount: dec,
		note: z.string().max(2000).nullable(),
		actorUserId: text,
		createdAt: date,
	})
	.strict();

export const transferStashSchema = z
	.object({
		sides: z.array(sideSchema).max(4),
		fee: z
			.object({
				categoryId: text.nullable(),
				budgetEnvelopeId: text.nullable(),
				entryKind: z.enum(["STANDARD", "NOT_SPENDING"]),
				excludeFromAnalytics: z.boolean(),
				date: z.iso.datetime(),
			})
			.strict()
			.nullable(),
	})
	.strict();

export type TransferStash = z.infer<typeof transferStashSchema>;

/** Read before the delete cascades the rows away. */
export async function stashTransfer(
	tx: Tx,
	userId: string,
	transfer: { id: string; feeExpenseId: string | null },
): Promise<TransferStash> {
	// Only your own sides: the policy lets you write only your own.
	const sides = await tx.wealthTransfer.findMany({
		where: { transferId: transfer.id, actorUserId: userId },
	});
	const fee = transfer.feeExpenseId
		? await tx.expense.findUnique({ where: { id: transfer.feeExpenseId } })
		: null;
	return {
		sides: sides.map((s) => packRow(s) as TransferStash["sides"][number]),
		fee: fee && {
			categoryId: fee.categoryId,
			budgetEnvelopeId: fee.budgetEnvelopeId,
			entryKind: fee.entryKind === "NOT_SPENDING" ? "NOT_SPENDING" : "STANDARD",
			excludeFromAnalytics: fee.excludeFromAnalytics,
			date: fee.date.toISOString(),
		},
	};
}

const refused = (message: string, code: "BAD_REQUEST" | "CONFLICT") =>
	new TRPCError({ code, message });

/** The same side, ignoring the ids and clocks a fresh write makes. */
const sameSide = (a: Row, b: Row) =>
	(
		[
			"direction",
			"envelopeId",
			"assetAccountId",
			"countOnly",
			"bookId",
		] as const
	).every((k) => a[k] === b[k]) &&
	JSON.stringify(a.amount) === JSON.stringify(b.amount) &&
	JSON.stringify(a.date) === JSON.stringify(b.date);

/**
 * Puts the stash on a transfer the plain recreate just wrote: its budget side
 * becomes the stored one (an equal side already there is kept, never two), and
 * its fee gets the stored fields.
 */
export async function restoreTransferStash(
	tx: Tx,
	userId: string,
	moved: { transferId: string; feeExpenseId: string | null },
	given: unknown,
): Promise<void> {
	const parsed = transferStashSchema.safeParse(given);
	if (!parsed.success) throw refused("Undo is not valid", "BAD_REQUEST");
	const stash = parsed.data;
	if (
		stash.sides.some(
			(s) => s.transferId !== moved.transferId || s.actorUserId !== userId,
		)
	)
		throw refused("Undo is not valid", "BAD_REQUEST");
	await restoreSides(tx, userId, moved.transferId, stash.sides);
	if (stash.fee && moved.feeExpenseId) {
		const category = stash.fee.categoryId
			? await tx.category.count({
					where: { id: stash.fee.categoryId, userId },
				})
			: 0;
		await tx.expense.update({
			where: { id: moved.feeExpenseId },
			data: {
				// A category deleted since leaves the fee uncategorized, as its delete would.
				categoryId: category > 0 ? stash.fee.categoryId : null,
				budgetEnvelopeId: stash.fee.budgetEnvelopeId,
				entryKind: stash.fee.entryKind,
				excludeFromAnalytics: stash.fee.excludeFromAnalytics,
				date: new Date(stash.fee.date),
			},
		});
	}
}

async function restoreSides(
	tx: Tx,
	userId: string,
	transferId: string,
	sides: readonly TransferStash["sides"][number][],
) {
	const now = await tx.wealthTransfer.findMany({
		where: { transferId, actorUserId: userId },
	});
	const have = now.map((s) => packRow(s));
	const kept = sides.filter((s) => have.some((h) => sameSide(h, s)));
	const same = kept.length === sides.length && have.length === sides.length;
	if (same) return;
	await tx.wealthTransfer.deleteMany({
		where: { transferId, actorUserId: userId },
	});
	for (const side of sides) {
		// The envelope, account and book must still be there; if not, the stored side cannot come back.
		const [book, envelope, account] = await Promise.all([
			tx.budgetBook.count({ where: { id: side.bookId } }),
			side.envelopeId
				? tx.envelope.count({
						where: { id: side.envelopeId, bookId: side.bookId },
					})
				: Promise.resolve(1),
			side.assetAccountId
				? tx.assetAccount.count({ where: { id: side.assetAccountId } })
				: Promise.resolve(1),
		]);
		if (!book || !envelope || !account)
			throw refused(
				"This transfer changed since. Undo is no longer safe.",
				"CONFLICT",
			);
		await tx.wealthTransfer.create({
			data: unpackRow(
				side as Row,
			) as unknown as Prisma.WealthTransferUncheckedCreateInput,
		});
	}
	forgetMonthViews(tx);
}
