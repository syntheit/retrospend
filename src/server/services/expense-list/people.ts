/**
 * Names and faces for person keys (`<type>:<id>`), in one batch per kind:
 * users, people you added (shadow profiles) and guests.
 */
import type { Prisma } from "~prisma";

type Db = Prisma.TransactionClient;

export type Who = { name: string; imageUrl: string | null };

/** The name rows use for a payer or the other side of a payment ("Martín paid"). */
export const firstName = (who: Who | undefined) =>
	who?.name.trim().split(/\s+/)[0] ?? "";

export const personKeyOf = (type: string, id: string) => `${type}:${id}`;

export async function resolvePeople(
	db: Db,
	keys: Iterable<string>,
): Promise<Map<string, Who>> {
	const byType: Record<string, string[]> = { user: [], shadow: [], guest: [] };
	for (const key of new Set(keys)) {
		const at = key.indexOf(":");
		byType[key.slice(0, at)]?.push(key.slice(at + 1));
	}
	const [users, shadows, guests] = await Promise.all([
		byType.user?.length
			? db.user.findMany({
					where: { id: { in: byType.user } },
					select: { id: true, name: true, avatarPath: true },
				})
			: [],
		byType.shadow?.length
			? db.shadowProfile.findMany({
					where: { id: { in: byType.shadow } },
					select: { id: true, name: true },
				})
			: [],
		byType.guest?.length
			? db.guestSession.findMany({
					where: { id: { in: byType.guest } },
					select: { id: true, name: true },
				})
			: [],
	]);
	const out = new Map<string, Who>();
	for (const u of users)
		out.set(personKeyOf("user", u.id), {
			name: u.name ?? "",
			imageUrl: u.avatarPath ? `/api/images/${u.avatarPath}` : null,
		});
	for (const s of shadows)
		out.set(personKeyOf("shadow", s.id), { name: s.name, imageUrl: null });
	for (const g of guests)
		out.set(personKeyOf("guest", g.id), { name: g.name, imageUrl: null });
	return out;
}
