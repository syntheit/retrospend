import { dayKey } from "~/lib/time-zone";
import { resolveClaimAliases } from "~/server/services/shared-expenses/identity";
import { userTimeZone } from "~/server/services/user-time-zone";
import type { PrismaClient } from "~prisma";
import { joinedAfter, toIsoDate } from "./membership";
import type { MemberRef, ProjectActor } from "./types";

function loadProject(db: PrismaClient, projectId: string) {
	return Promise.all([
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
}

type Expenses = Awaited<ReturnType<typeof loadProject>>[0];
type Members = Awaited<ReturnType<typeof loadProject>>[1];

/**
 * The newcomer's identity key and the keys of every other member, with a
 * claimed ghost and its user as one person (as in the rebalance itself).
 */
async function memberKeys(
	db: PrismaClient,
	newcomer: MemberRef,
	members: Members,
	expenses: Expenses,
) {
	const { canonicalKey } = await resolveClaimAliases(db, [
		newcomer,
		...members.map(({ participantType, participantId }) => ({
			participantType,
			participantId,
		})),
		...expenses.flatMap((e) => e.splitParticipants),
	]);
	const newcomerKey = canonicalKey(newcomer);
	const others = new Set(
		members.map((m) => canonicalKey(m)).filter((k) => k !== newcomerKey),
	);
	return { canonicalKey, newcomerKey, others };
}

/**
 * Past expenses a newly added member could be folded into (the choice that
 * follows adding someone). Leaves out settled expenses and ones they are
 * already in; only EQUAL expenses are `eligible`, because other split modes
 * cannot be recomputed without the user. Expenses dated before the person
 * joined (by the day in the acting user's zone) are flagged `beforeJoin` and
 * never preselected (RC-11). The caller must be an editor.
 */
export async function rebalanceableExpenses(
	db: PrismaClient,
	{ userId, timeZone }: ProjectActor,
	projectId: string,
	newcomer: MemberRef,
) {
	const [expenses, members] = await loadProject(db, projectId);
	const row = members.find(
		(m) =>
			m.participantType === newcomer.participantType &&
			m.participantId === newcomer.participantId,
	);
	const joined = { joinedOn: row?.joinedOn ? toIsoDate(row.joinedOn) : null };
	const zone = await userTimeZone(db, userId, timeZone);
	const { canonicalKey, newcomerKey, others } = await memberKeys(
		db,
		newcomer,
		members,
		expenses,
	);

	return expenses
		.filter((e) => !e.isLocked)
		.filter(
			(e) =>
				!e.splitParticipants.some((sp) => canonicalKey(sp) === newcomerKey),
		)
		.map((e) => {
			const inSplit = new Set(e.splitParticipants.map(canonicalKey));
			const beforeJoin = joinedAfter(joined, dayKey(e.date, zone));
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
				// "Split with everyone" only if it has every other member.
				hasAllOtherMembers:
					!beforeJoin && [...others].every((k) => inSplit.has(k)),
			};
		});
}
