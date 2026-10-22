import type { ParticipantType } from "~prisma";

/** Who reads a project: a member (user or guest) or an anonymous viewer link. */
export interface ProjectViewer {
	participantType: ParticipantType | "viewerLink";
	participantId: string;
}

/** A signed-in user acting on a project. */
export interface ProjectActor {
	userId: string;
}

export type ProjectRoleName = "ORGANIZER" | "EDITOR" | "CONTRIBUTOR" | "VIEWER";

/** A project member as the procedures name them (viewer links are never members). */
export interface MemberRef {
	participantType: Extract<ParticipantType, "user" | "guest" | "shadow">;
	participantId: string;
}
