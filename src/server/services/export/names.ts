import { db as globalDb } from "~/server/db";
import type { PrismaClient } from "~prisma";

export interface NameRef {
	participantType: string;
	participantId: string;
}

export const refKeyOf = (r: NameRef) =>
	`${r.participantType}:${r.participantId}`;

const DELETED_USER = "DELETED_USER";
const DELETED_GUEST = "DELETED_GUEST";

/**
 * Resolves display names for a list of participant refs in a single batch.
 * Returns a Map from "type:id" to name; anyone missing reads "Unknown" at
 * the call site.
 */
export async function resolveParticipantNames(
	db: PrismaClient,
	refs: readonly NameRef[],
): Promise<Map<string, string>> {
	const unique = new Map<string, NameRef>();
	for (const r of refs) unique.set(refKeyOf(r), r);
	const all = [...unique.values()];

	const idsOf = (type: string, except?: string) =>
		all
			.filter((r) => r.participantType === type && r.participantId !== except)
			.map((r) => r.participantId);
	const userIds = idsOf("user", DELETED_USER);
	const shadowIds = idsOf("shadow");
	const guestIds = idsOf("guest", DELETED_GUEST);

	const [users, shadows, guests] = await Promise.all([
		userIds.length > 0
			? db.user.findMany({
					where: { id: { in: userIds } },
					select: { id: true, name: true },
				})
			: [],
		shadowIds.length > 0
			? db.shadowProfile.findMany({
					where: { id: { in: shadowIds } },
					select: { id: true, name: true },
				})
			: [],
		guestIds.length > 0
			? db.guestSession.findMany({
					where: { id: { in: guestIds } },
					select: { id: true, name: true },
				})
			: [],
	]);

	const result = new Map<string, string>();
	result.set(`user:${DELETED_USER}`, "Deleted User");
	result.set(`guest:${DELETED_GUEST}`, "Deleted Guest");
	for (const u of users) result.set(`user:${u.id}`, u.name ?? "Unknown");
	for (const s of shadows) result.set(`shadow:${s.id}`, s.name ?? "Unknown");
	for (const g of guests) result.set(`guest:${g.id}`, g.name ?? "Unknown");
	return result;
}

export const nameOf = (names: ReadonlyMap<string, string>, ref: NameRef) =>
	names.get(refKeyOf(ref)) ?? "Unknown";

/**
 * Returns a map of transactionId to edit count (EDITED audit entries). Ids
 * with no edits are absent. Read through the global client: the audit log is
 * not visible to a user-scoped client, and only counts leave this function.
 */
export async function fetchEditCounts(
	transactionIds: string[],
): Promise<Map<string, number>> {
	if (transactionIds.length === 0) return new Map();
	const entries = await globalDb.auditLogEntry.groupBy({
		by: ["targetId"],
		where: {
			targetId: { in: transactionIds },
			action: "EDITED",
			targetType: "SHARED_TRANSACTION",
		},
		_count: { _all: true },
	});
	return new Map(entries.map((e) => [e.targetId, e._count._all]));
}

/** The review state of a split expense as a word. */
export function txStatus(
	isLocked: boolean,
	splitParticipants: ReadonlyArray<{ verificationStatus: string }>,
): string {
	if (isLocked) return "Settled";
	if (splitParticipants.some((sp) => sp.verificationStatus === "REJECTED"))
		return "Disputed";
	if (splitParticipants.every((sp) => sp.verificationStatus === "ACCEPTED"))
		return "Verified";
	return "Pending";
}
