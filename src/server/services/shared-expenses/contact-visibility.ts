import type { Prisma, PrismaClient } from "~prisma";
import type { ParticipantRef } from "./types";

/**
 * Who may see a ghost's or guest's contact details (email, phone).
 *
 * Ghost and guest contact details are things an organizer typed in, or a guest
 * entered under "not shared publicly". Sharing an expense with someone is not
 * a reason to see them. The one rule, used everywhere these details leave the
 * server (project views, people list/detail, people search):
 *
 *   - Ghost (shadow): visible to its creator, and to anyone who is EDITOR or
 *     ORGANIZER in a project the ghost belongs to.
 *   - Guest: visible to the guest themself, and to EDITOR or ORGANIZER members
 *     of the guest's project.
 *   - Registered users: never exposed through these views (callers already
 *     return null for them).
 *
 * Everyone else (contributors, viewers, viewer links, other guests) gets null.
 */

type Db = PrismaClient | Prisma.TransactionClient;
type Ref = { participantType: string; participantId: string };

export type ContactVisibility = (ref: Ref) => boolean;

const MANAGER_ROLES = ["EDITOR", "ORGANIZER"] as const;

const NOBODY: ContactVisibility = () => false;

/**
 * Resolves, in a few batched queries, which of `refs` the viewer may see
 * contact details for. `viewer` is null for anonymous callers (viewer links,
 * public pages), who see none.
 */
export async function buildContactVisibility(
	db: Db,
	viewer: ParticipantRef | null,
	refs: Ref[],
): Promise<ContactVisibility> {
	if (!viewer) return NOBODY;

	const isSelf = (r: Ref) =>
		r.participantType === viewer.participantType &&
		r.participantId === viewer.participantId;

	const shadowIds = [
		...new Set(
			refs
				.filter((r) => r.participantType === "shadow" && !isSelf(r))
				.map((r) => r.participantId),
		),
	];
	const guestIds = [
		...new Set(
			refs
				.filter((r) => r.participantType === "guest" && !isSelf(r))
				.map((r) => r.participantId),
		),
	];

	const visibleShadows = new Set<string>();
	const visibleGuests = new Set<string>();

	if (shadowIds.length > 0 || guestIds.length > 0) {
		const managed = await db.projectParticipant.findMany({
			where: {
				participantType: viewer.participantType,
				participantId: viewer.participantId,
				role: { in: [...MANAGER_ROLES] },
			},
			select: { projectId: true },
		});
		const managedProjectIds = [...new Set(managed.map((m) => m.projectId))];

		if (shadowIds.length > 0) {
			if (viewer.participantType === "user") {
				const created = await db.shadowProfile.findMany({
					where: { id: { in: shadowIds }, createdById: viewer.participantId },
					select: { id: true },
				});
				for (const s of created) visibleShadows.add(s.id);
			}
			if (managedProjectIds.length > 0) {
				const inManaged = await db.projectParticipant.findMany({
					where: {
						participantType: "shadow",
						participantId: { in: shadowIds },
						projectId: { in: managedProjectIds },
					},
					select: { participantId: true },
				});
				for (const m of inManaged) visibleShadows.add(m.participantId);
			}
		}

		if (guestIds.length > 0 && managedProjectIds.length > 0) {
			const guests = await db.guestSession.findMany({
				where: { id: { in: guestIds }, projectId: { in: managedProjectIds } },
				select: { id: true },
			});
			for (const g of guests) visibleGuests.add(g.id);
		}
	}

	return (r) =>
		isSelf(r) ||
		(r.participantType === "shadow" && visibleShadows.has(r.participantId)) ||
		(r.participantType === "guest" && visibleGuests.has(r.participantId));
}

/** Nulls email (and phone, when present) unless the viewer may see them. */
export function redactContact<
	T extends Ref & { email: string | null; phone?: string | null },
>(item: T, visible: ContactVisibility): T {
	if (visible(item)) return item;
	return "phone" in item
		? { ...item, email: null, phone: null }
		: { ...item, email: null };
}
