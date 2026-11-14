/**
 * A split as the corrections see it: the original row plus every correction
 * row written for it, as plain minor-unit data (plan.ts) and the people who
 * may be on it.
 */
import { shareCounts } from "@retrospend/domain/share-status";
import { TRPCError } from "@trpc/server";
import type { Prisma, ShareCategorySource } from "~prisma";
import { toMinor } from "../envelope/units";
import { type Party, partyKey, type RowState } from "./plan";

type Tx = Prisma.TransactionClient;

const WITH_SHARES = { splitParticipants: true } as const;

export type SplitRecord = Prisma.SharedTransactionGetPayload<{
	include: typeof WITH_SHARES;
}>;

export interface LoadedSplit {
	readonly original: SplitRecord;
	readonly corrections: readonly SplitRecord[];
}

/** The split `id` with its correction rows, as the caller may see them (RLS). */
export async function loadSplit(tx: Tx, id: string): Promise<LoadedSplit> {
	const original = await tx.sharedTransaction.findUnique({
		where: { id },
		include: WITH_SHARES,
	});
	if (!original) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
	}
	const corrections = await tx.sharedTransaction.findMany({
		where: { correctsId: id },
		include: WITH_SHARES,
		orderBy: [{ createdAt: "asc" }, { id: "asc" }],
	});
	return { original, corrections };
}

export const partyOf = (type: Party["participantType"], id: string): Party => ({
	participantType: type,
	participantId: id,
});

/**
 * A row as the plan starts from it: only the shares that count (a rejected
 * one is not owed, so a correction never reverses it), and the payer carries
 * what those rejected shares left uncovered, as every balance charges it
 * (ledger-posting.ts), so reversing the row reverses what was posted.
 */
export function rowStateOf(record: SplitRecord): RowState {
	const minorOf = (p: { shareAmount: { toString(): string } }) =>
		toMinor(p.shareAmount.toString(), record.currency);
	const payer = partyOf(record.paidByType, record.paidById);
	const shares = record.splitParticipants
		.filter((p) => shareCounts(p.verificationStatus))
		.map((p) => ({
			party: partyOf(p.participantType, p.participantId),
			minor: minorOf(p),
		}));
	const absorbed = record.splitParticipants
		.filter((p) => !shareCounts(p.verificationStatus))
		.reduce((sum, p) => sum + minorOf(p), 0);
	if (absorbed !== 0) {
		const key = partyKey(payer);
		const own = shares.findIndex((s) => partyKey(s.party) === key);
		if (own >= 0)
			shares[own] = {
				party: payer,
				minor: (shares[own] as { minor: number }).minor + absorbed,
			};
		else shares.push({ party: payer, minor: absorbed });
	}
	return {
		payer,
		categoryId: record.categoryId,
		amountMinor: toMinor(record.amount.toString(), record.currency),
		shares,
	};
}

/** What the split is now: the original and every correction added up. */
export const effectiveRows = (split: LoadedSplit): RowState[] =>
	[split.original, ...split.corrections].map(rowStateOf);

/**
 * Who may be on a corrected split: the people already on it or paying it,
 * and the members of its project. Anyone else goes in a new expense.
 */
export async function allowedPeople(
	tx: Tx,
	split: LoadedSplit,
): Promise<Set<string>> {
	const keys = new Set<string>();
	for (const row of [split.original, ...split.corrections]) {
		keys.add(partyKey(partyOf(row.paidByType, row.paidById)));
		for (const p of row.splitParticipants)
			keys.add(partyKey(partyOf(p.participantType, p.participantId)));
	}
	if (split.original.projectId) {
		const members = await tx.projectParticipant.findMany({
			where: { projectId: split.original.projectId },
			select: { participantType: true, participantId: true },
		});
		for (const m of members)
			keys.add(partyKey(partyOf(m.participantType, m.participantId)));
	}
	return keys;
}

/** A person's own category for their share, per bucket, so a correction row keeps it (D19). */
export function shareCategories(split: LoadedSplit) {
	const found = new Map<
		string,
		{ categoryId: string; source: ShareCategorySource | null }
	>();
	for (const row of [split.original, ...split.corrections]) {
		for (const p of row.splitParticipants) {
			if (!p.categoryId) continue;
			const key = `${partyKey(partyOf(row.paidByType, row.paidById))}|${row.categoryId ?? ""}|${partyKey(partyOf(p.participantType, p.participantId))}`;
			if (!found.has(key))
				found.set(key, {
					categoryId: p.categoryId,
					source: p.categorySource,
				});
		}
	}
	return found;
}
