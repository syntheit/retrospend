import type { RetrospendClient } from "@retrospend/api-client";
import type { ProjectMember } from "./source";

// The dates of one member of a project: when they joined and when they left.
// They only choose who a new expense includes by default; saved splits never
// change. The server's dry run of the write says so before Save (R30).

export type MemberDatesBody = Parameters<
	RetrospendClient["projects"]["setMemberDates"]
>[0];

/** The two dates as the sheet edits them; null is "from the start" and "still here". */
export interface MemberDates {
	joinedOn: string | null;
	leftOn: string | null;
}

export function datesOf(member: ProjectMember): MemberDates {
	return { joinedOn: member.joinedOn, leftOn: member.leftOn };
}

export function datesChanged(member: ProjectMember, next: MemberDates) {
	return next.joinedOn !== member.joinedOn || next.leftOn !== member.leftOn;
}

/** The leave day has to come after the join day (the server refuses anything else). */
export function datesOutOfOrder(next: MemberDates): boolean {
	return (
		next.joinedOn !== null &&
		next.leftOn !== null &&
		next.leftOn <= next.joinedOn
	);
}

/** The body that writes `dates` for a member; Undo sends the old pair. */
export function bodyOf(
	projectId: string,
	member: Pick<ProjectMember, "participantType" | "participantId">,
	dates: MemberDates,
): MemberDatesBody {
	return {
		id: projectId,
		type: member.participantType,
		personId: member.participantId,
		joinedOn: dates.joinedOn,
		leftOn: dates.leftOn,
	};
}

/**
 * The exact body of the write and of its dry run, or null while there is
 * nothing to save (no change, or dates in the wrong order). Both dates are
 * always sent, so an Undo that sends the old pair restores them exactly.
 */
export function datesBody(
	projectId: string,
	member: ProjectMember,
	next: MemberDates,
): MemberDatesBody | null {
	if (!datesChanged(member, next) || datesOutOfOrder(next)) return null;
	return bodyOf(projectId, member, next);
}

/**
 * Only an Owner changes an Owner's dates; the server checks it again. The
 * row of an Owner stays closed for an Editor.
 */
export function canSetDates(
	myRole: string | null,
	member: Pick<ProjectMember, "role">,
): boolean {
	if (myRole === "ORGANIZER") return true;
	return myRole === "EDITOR" && member.role !== "ORGANIZER";
}

/** Which sentence says what the dates mean for new expenses. */
export function datesMeaning(next: MemberDates): "leaves" | "joins" | "always" {
	return next.leftOn ? "leaves" : next.joinedOn ? "joins" : "always";
}
