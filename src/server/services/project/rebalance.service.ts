import { resolveClaimAliases } from "~/server/services/shared-expenses/identity";
import type { PrismaClient } from "~prisma";
import { joinedAfter, toIsoDate } from "./membership";
import type { MemberRef } from "./types";

/**
 * Past expenses a newly added member could be folded into (the choice that
 * follows adding someone). Leaves out settled expenses and ones they are
 * already in; only EQUAL expenses are `eligible`, because other split modes
 * cannot be recomputed without the user. Expenses dated before the person
 * joined are flagged `beforeJoin` and never preselected (RC-11). The caller
 * must be an editor.
 */
export async function rebalanceableExpenses(
	db: PrismaClient,
	projectId: string,
	newcomer: MemberRef,
) {
	const [expenses, members] = await Promise.all([
		db.sharedTransaction.findMany({
			where: { projectId },
			select: {
				id: true,
				description: true,
				amount: true,
				currency: true,
				date: true,
				splitMode: true,
				isLocked: true,
				splitParticipants: {
					select: { participantType: true, participantId: true },
				},
			},
			orderBy: { date: "desc" },
		}),
		db.projectParticipant.findMany({
			where: { projectId },
			select: { participantType: true, participantId: true, joinedOn: true },
		}),
	]);
	const newcomerRow = members.find(
		(m) =>
			m.participantType === newcomer.participantType &&
			m.participantId === newcomer.participantId,
	);
	const joined = {
		joinedOn: newcomerRow?.joinedOn ? toIsoDate(newcomerRow.joinedOn) : null,
	};

	// A claimed ghost and its user are one person here, as in the rebalance itself.
	const { canonicalKey } = await resolveClaimAliases(db, [
		newcomer,
		...members.map(({ participantType, participantId }) => ({
			participantType,
			participantId,
		})),
		...expenses.flatMap((e) => e.splitParticipants),
	]);
	const newcomerKey = canonicalKey(newcomer);
	// An expense is "split with everyone" only if it has every other member.
	const others = new Set(
		members.map((m) => canonicalKey(m)).filter((k) => k !== newcomerKey),
	);

	return expenses
		.filter((e) => !e.isLocked)
		.filter(
			(e) =>
				!e.splitParticipants.some((sp) => canonicalKey(sp) === newcomerKey),
		)
		.map((e) => {
			const inSplit = new Set(
				e.splitParticipants.map((sp) => canonicalKey(sp)),
			);
			// RC-11: an expense from before they joined is never theirs by default.
			const beforeJoin = joinedAfter(joined, toIsoDate(e.date));
			return {
				id: e.id,
				description: e.description,
				amount: Number(e.amount),
				currency: e.currency,
				date: e.date,
				splitMode: e.splitMode,
				eligible: e.splitMode === "EQUAL",
				currentParticipantCount: e.splitParticipants.length,
				beforeJoin,
				hasAllOtherMembers:
					!beforeJoin && [...others].every((k) => inSplit.has(k)),
			};
		});
}
