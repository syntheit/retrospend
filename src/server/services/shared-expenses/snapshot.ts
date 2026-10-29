/**
 * A split expense as it is stored, for the undo of its delete. The delete
 * cascades the expense's shares and its requests to fix it away, so all of
 * them are kept: every column comes back as it was (id, each person's share
 * and verification answer, rates, timestamps), not recomputed. Decimals and
 * dates are tagged so JSON keeps them exact (entry/row-pack.ts).
 */
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";
import { packRow, type Row, unpackRow } from "../entry/row-pack";

type Tx = Prisma.TransactionClient;

export interface SharedSnapshot {
	readonly userId: string;
	readonly expense: Row;
	readonly shares: readonly Row[];
	readonly fixRequests: readonly Row[];
}

export async function snapshotShared(
	tx: Tx,
	userId: string,
	id: string,
): Promise<SharedSnapshot> {
	const row = await tx.sharedTransaction.findUnique({
		where: { id },
		include: { splitParticipants: true, fixRequests: true },
	});
	if (!row) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
	}
	const { splitParticipants, fixRequests, ...expense } = row;
	return {
		userId,
		expense: packRow(expense),
		shares: splitParticipants.map(packRow),
		fixRequests: fixRequests.map(packRow),
	};
}

/** The ids of these rows that still exist, so a link to a row deleted since is dropped, not invented. */
async function stillThere(
	ids: (string | null | undefined)[],
	find: (ids: string[]) => Promise<{ id: string }[]>,
) {
	const wanted = [...new Set(ids.filter((v): v is string => !!v))];
	if (wanted.length === 0) return new Set<string>();
	return new Set((await find(wanted)).map((r) => r.id));
}

const cannotRestore = (message: string) =>
	new TRPCError({ code: "CONFLICT", message });

/**
 * A restore follows the rules of an add: everyone on it who is not a shadow is
 * still a member of its project, and its period is still open (an add lands only
 * in an open one). Otherwise it would put back an expense the project would not
 * take now, so it is refused and nothing is written.
 */
async function assertStillFits(
	tx: Tx,
	expense: Prisma.SharedTransactionUncheckedCreateInput,
	shares: readonly Prisma.SplitParticipantUncheckedCreateInput[],
) {
	const projectId = expense.projectId;
	if (!projectId) return;
	const project = await tx.project.findUnique({
		where: { id: projectId },
		select: { id: true },
	});
	if (!project) return; // The project is gone: the link is dropped, as before.
	const people = [
		{ type: expense.paidByType, id: expense.paidById },
		...shares.map((s) => ({ type: s.participantType, id: s.participantId })),
	].filter((p) => p.type !== "shadow");
	if (people.length > 0) {
		const members = await tx.projectParticipant.findMany({
			where: {
				projectId,
				OR: people.map((p) => ({
					participantType: p.type,
					participantId: p.id,
				})),
			},
			select: { participantType: true, participantId: true },
		});
		const here = new Set(
			members.map((m) => `${m.participantType}:${m.participantId}`),
		);
		if (people.some((p) => !here.has(`${p.type}:${p.id}`)))
			throw cannotRestore(
				"Someone on this expense left the project since. Undo is no longer safe.",
			);
	}
	if (expense.billingPeriodId) {
		const period = await tx.billingPeriod.findUnique({
			where: { id: expense.billingPeriodId },
			select: { status: true },
		});
		if (period && period.status !== "OPEN")
			throw cannotRestore(
				"Its billing period is closed since. Undo is no longer safe.",
			);
	}
}

/**
 * Puts the expense back with every share, the answers people gave and the
 * requests that involve you. Returns the restored expense with its shares.
 */
export async function restoreShared(
	tx: Tx,
	userId: string,
	snapshot: SharedSnapshot,
) {
	const expense = unpackRow(
		snapshot.expense,
	) as unknown as Prisma.SharedTransactionUncheckedCreateInput;
	if (
		snapshot.userId !== userId ||
		expense.createdByType !== "user" ||
		expense.createdById !== userId
	) {
		throw new TRPCError({ code: "FORBIDDEN", message: "Expense not found" });
	}
	const there = await tx.sharedTransaction.findUnique({
		where: { id: expense.id },
		select: { id: true },
	});
	if (there) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "This expense is back already.",
		});
	}
	const shares = snapshot.shares.map(
		(s) =>
			unpackRow(s) as unknown as Prisma.SplitParticipantUncheckedCreateInput,
	);
	const [categories, projects, periods] = await Promise.all([
		stillThere(
			[expense.categoryId, ...shares.map((s) => s.categoryId)],
			(ids) =>
				tx.category.findMany({
					where: { id: { in: ids } },
					select: { id: true },
				}),
		),
		stillThere([expense.projectId], (ids) =>
			tx.project.findMany({ where: { id: { in: ids } }, select: { id: true } }),
		),
		stillThere([expense.billingPeriodId], (ids) =>
			tx.billingPeriod.findMany({
				where: { id: { in: ids } },
				select: { id: true },
			}),
		),
	]);
	await assertStillFits(tx, expense, shares);
	const keep = (set: Set<string>, id: string | null | undefined) =>
		id && set.has(id) ? id : null;
	await tx.sharedTransaction.create({
		data: {
			...expense,
			categoryId: keep(categories, expense.categoryId),
			projectId: keep(projects, expense.projectId),
			billingPeriodId: keep(periods, expense.billingPeriodId),
			// A correction is never deleted by hand and is not restorable.
			correctsId: null,
		},
	});
	await tx.splitParticipant.createMany({
		data: shares.map((s) => ({
			...s,
			categoryId: keep(categories, s.categoryId),
		})),
	});
	// Requests between other people are theirs: a person restores only their own.
	const mine = snapshot.fixRequests
		.map(
			(r) => unpackRow(r) as unknown as Prisma.FixRequestUncheckedCreateInput,
		)
		.filter(
			(r) =>
				(r.requestedByType === "user" && r.requestedById === userId) ||
				(r.askedType === "user" && r.askedId === userId),
		);
	if (mine.length > 0) await tx.fixRequest.createMany({ data: mine });
	return tx.sharedTransaction.findUniqueOrThrow({
		where: { id: expense.id },
		include: { splitParticipants: true },
	});
}
