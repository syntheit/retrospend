/**
 * project.membershipDates: when someone joined or left a project. The dates
 * only choose who a new expense includes by default (RC-11); a split that is
 * already saved never changes. The settings sheet previews this mutation
 * (R30), so "Balances: no change" is checked against the real figures, not
 * promised: the preview runs the write and compares the project total, the
 * person's group balance and your balance with them before and after.
 */
import { TRPCError } from "@trpc/server";
import type { MoneyMutation } from "~/server/services/preview/types";
import { logAudit } from "~/server/services/shared-expenses/audit-log";
import {
	assertValidMembership,
	fromIsoDate,
	InvalidMembershipDatesError,
	type IsoDate,
	type MembershipDates,
	membershipOf,
} from "./membership";
import { refKey } from "./summary";
import type { MemberRef, ProjectRoleName } from "./types";

export interface SetMembershipInput extends MemberRef {
	projectId: string;
	/** Omit to keep; null clears it ("from the start"). */
	joinedOn?: IsoDate | null;
	/** Omit to keep; null clears it ("still a member"). */
	leftOn?: IsoDate | null;
}

export interface MembershipChange extends MemberRef, MembershipDates {
	role: ProjectRoleName;
	/** The dates before this change, for Undo. */
	before: MembershipDates;
}

/** Turns a bad date into the BAD_REQUEST a procedure returns. */
export function badDates<T>(work: () => T): T {
	try {
		return work();
	} catch (error) {
		if (error instanceof InvalidMembershipDatesError) {
			throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
		}
		throw error;
	}
}

/** The stored values for `input` on top of `before`, or BAD_REQUEST. */
function nextDates(before: MembershipDates, input: SetMembershipInput) {
	const after: MembershipDates = {
		joinedOn: input.joinedOn === undefined ? before.joinedOn : input.joinedOn,
		leftOn: input.leftOn === undefined ? before.leftOn : input.leftOn,
	};
	const data = badDates(() => {
		assertValidMembership(after);
		return {
			joinedOn: after.joinedOn ? fromIsoDate(after.joinedOn) : null,
			leftOn: after.leftOn ? fromIsoDate(after.leftOn) : null,
		};
	});
	return { after, data };
}

/**
 * Leaving keeps the person in the project (their past expenses and balances
 * stay). Editors set other members' dates; an owner's dates only an owner
 * may change. The caller's role is checked by the transport first.
 */
export const setMembershipDatesMutation: MoneyMutation<
	SetMembershipInput & { callerRole: ProjectRoleName },
	MembershipChange
> = {
	id: "project.membershipDates",
	touches: ["project.total", "project.member.balance"],
	scope: (input) => ({ projectId: input.projectId, personId: refKey(input) }),
	run: async (tx, input, actor) => {
		const { projectId, participantType, participantId } = input;
		const row = await tx.projectParticipant.findUnique({
			where: {
				projectId_participantType_participantId: {
					projectId,
					participantType,
					participantId,
				},
			},
		});
		if (!row) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Participant not found in this project",
			});
		}
		if (row.role === "ORGANIZER" && input.callerRole !== "ORGANIZER") {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Only an Owner can change an Owner's dates",
			});
		}
		const before = membershipOf(row);
		const { after, data } = nextDates(before, input);
		const updated = await tx.projectParticipant.update({
			where: { id: row.id },
			data,
		});
		await logAudit(tx, {
			actor: { participantType: "user", participantId: actor.userId },
			action: "EDITED",
			targetType: "PROJECT",
			targetId: projectId,
			changes: {
				participantType,
				participantId,
				membership: { old: { ...before }, new: { ...after } },
			},
			projectId,
		});
		return {
			value: {
				participantType,
				participantId,
				role: updated.role,
				...membershipOf(updated),
				before,
			},
			undo: {
				kind: "revert",
				mutation: "project.membershipDates",
				rows: [{ table: "project_participant", id: row.id }],
			},
		};
	},
};
