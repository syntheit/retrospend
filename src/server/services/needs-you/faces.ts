/**
 * Names and pictures for the faces the items show: at most one query per
 * participant type. Only display fields, never contact details, so no
 * contact-visibility rule applies (people.service redacts those).
 */
import { parsePersonKey } from "~/server/services/payments/view";
import {
	DELETED_GUEST_SENTINEL,
	DELETED_SHADOW_SENTINEL,
	DELETED_USER_SENTINEL,
} from "~/server/services/user-deletion.service";
import { getImageUrl } from "~/server/storage";
import type { Prisma } from "~prisma";
import type { NeedsYouFace, PersonKey } from "./types";

type Tx = Prisma.TransactionClient;

const idsOf = (
	refs: { participantType: string; participantId: string }[],
	type: string,
) => refs.filter((r) => r.participantType === type).map((r) => r.participantId);

export async function loadFaces(
	tx: Tx,
	keys: Iterable<PersonKey>,
): Promise<Record<PersonKey, NeedsYouFace>> {
	const refs = [...new Set(keys)].flatMap((key) => {
		const ref = parsePersonKey(key);
		return ref ? [ref] : [];
	});
	const userIds = idsOf(refs, "user").filter(
		(id) => id !== DELETED_USER_SENTINEL,
	);
	const shadowIds = idsOf(refs, "shadow").filter(
		(id) => id !== DELETED_SHADOW_SENTINEL,
	);
	const guestIds = idsOf(refs, "guest").filter(
		(id) => id !== DELETED_GUEST_SENTINEL,
	);
	const users = userIds.length
		? await tx.user.findMany({
				where: { id: { in: userIds } },
				select: { id: true, name: true, image: true, avatarPath: true },
			})
		: [];
	const shadows = shadowIds.length
		? await tx.shadowProfile.findMany({
				where: { id: { in: shadowIds } },
				select: { id: true, name: true },
			})
		: [];
	const guests = guestIds.length
		? await tx.guestSession.findMany({
				where: { id: { in: guestIds } },
				select: { id: true, name: true },
			})
		: [];
	const userById = new Map(users.map((u) => [u.id, u]));
	const nameOf = new Map<string, string>([
		...shadows.map((s) => [`shadow:${s.id}`, s.name] as const),
		...guests.map((g) => [`guest:${g.id}`, g.name] as const),
	]);
	const out: Record<PersonKey, NeedsYouFace> = {};
	for (const ref of refs) {
		const key = `${ref.participantType}:${ref.participantId}`;
		const user =
			ref.participantType === "user" ? userById.get(ref.participantId) : null;
		out[key] = {
			key,
			// An unknown or deleted person still gets a face: an empty name the client labels.
			name: user?.name ?? nameOf.get(key) ?? "",
			imageUrl: user
				? (getImageUrl(user.avatarPath ?? null) ?? user.image ?? null)
				: null,
			onRetrospend: Boolean(user),
		};
	}
	return out;
}
