/**
 * Reading and changing project membership dates. `membersOn` is what the
 * expense sheet preselects for a project expense on a given day (RC-11).
 */
import { dayKey } from "~/lib/time-zone";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { userTimeZone } from "~/server/services/user-time-zone";
import type { PrismaClient } from "~prisma";
import { type IsoDate, isMemberOn, membershipOf } from "./membership";
import {
	badDates,
	type SetMembershipInput,
	setMembershipDatesMutation,
} from "./membership.mutation";
import type { ProjectActor, ProjectRoleName } from "./types";

export { badDates };

/**
 * Everyone who was a member of the project on `day`, with their dates and
 * role. Without a day: today, in the reader's zone (userTimeZone).
 */
export async function membersOn(
	db: PrismaClient,
	projectId: string,
	day: IsoDate | undefined,
	readerUserId: string | null,
	requestZone?: string,
) {
	const onDay =
		day ??
		dayKey(new Date(), await userTimeZone(db, readerUserId, requestZone));
	const rows = await db.projectParticipant.findMany({
		where: { projectId },
		select: {
			participantType: true,
			participantId: true,
			role: true,
			joinedOn: true,
			leftOn: true,
		},
		orderBy: { joinedAt: "asc" },
	});
	return rows
		.map((r) => ({
			participantType: r.participantType,
			participantId: r.participantId,
			role: r.role,
			...membershipOf(r),
		}))
		.filter((m) => isMemberOn(m, onDay));
}

/**
 * Sets when someone joined or left (membership.mutation.ts): the same code
 * the settings sheet previews. The caller must be an editor.
 */
export async function setMembershipDates(
	db: PrismaClient,
	{ userId }: ProjectActor,
	callerRole: ProjectRoleName,
	input: SetMembershipInput,
) {
	return userTransaction(db, userId, async (tx) => {
		const { value } = await setMembershipDatesMutation.run(
			tx,
			{ ...input, callerRole },
			{ userId },
		);
		const { before: _before, ...dates } = value;
		return dates;
	});
}

/** The settings sheet's preview of a date change (R30): what moves and what does not. */
export const previewMembershipDates = (
	userId: string,
	callerRole: ProjectRoleName,
	input: SetMembershipInput,
) =>
	forUser(userId).preview(setMembershipDatesMutation, { ...input, callerRole });
