/**
 * The five people the user splits expenses with most often, for the expense
 * form's quick picks. Excludes the user and guests. Moved out of the people
 * router so the transport holds no logic.
 */
import { getImageUrl } from "~/server/storage";
import type { PrismaClient } from "~prisma";

export async function frequentSplitPartners(db: PrismaClient, userId: string) {
	const userParticipations = await db.splitParticipant.findMany({
		where: { participantType: "user", participantId: userId },
		select: { transactionId: true },
	});

	if (userParticipations.length === 0) return [];
	const txIds = userParticipations.map((p) => p.transactionId);

	// Group co-participants by frequency (take extra to filter out self in JS)
	const allPartnerGroups = await db.splitParticipant.groupBy({
		by: ["participantType", "participantId"],
		where: {
			transactionId: { in: txIds },
			participantType: { in: ["user", "shadow"] },
		},
		_count: { transactionId: true },
		orderBy: { _count: { transactionId: "desc" } },
		take: 10,
	});

	const partnerGroups = allPartnerGroups
		.filter(
			(g) => !(g.participantType === "user" && g.participantId === userId),
		)
		.slice(0, 5);

	if (partnerGroups.length === 0) return [];

	const userIds = partnerGroups
		.filter((g) => g.participantType === "user")
		.map((g) => g.participantId);
	const shadowIds = partnerGroups
		.filter((g) => g.participantType === "shadow")
		.map((g) => g.participantId);

	const [users, shadows] = await Promise.all([
		userIds.length > 0
			? db.user.findMany({
					where: { id: { in: userIds } },
					select: {
						id: true,
						name: true,
						username: true,
						image: true,
						avatarPath: true,
					},
				})
			: Promise.resolve([]),
		shadowIds.length > 0
			? db.shadowProfile.findMany({
					where: { id: { in: shadowIds }, createdById: userId },
					select: { id: true, name: true, email: true },
				})
			: Promise.resolve([]),
	]);

	const userMap = new Map(users.map((u) => [u.id, u]));
	const shadowMap = new Map(shadows.map((s) => [s.id, s]));

	return partnerGroups
		.map((g) => {
			if (g.participantType === "user") {
				const u = userMap.get(g.participantId);
				if (!u) return null;
				return {
					participantType: "user" as const,
					participantId: g.participantId,
					name: u.name ?? "Unknown",
					email: null as string | null,
					username: u.username ?? null,
					avatarUrl: getImageUrl(u.avatarPath) ?? u.image ?? null,
				};
			}
			const s = shadowMap.get(g.participantId);
			if (!s) return null;
			return {
				participantType: "shadow" as const,
				participantId: g.participantId,
				name: s.name,
				email: s.email,
				username: null as string | null,
				avatarUrl: null as string | null,
			};
		})
		.filter((p): p is NonNullable<typeof p> => p !== null);
}
