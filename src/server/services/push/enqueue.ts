import type { Prisma, PushDevice } from "~prisma";
import { enabledTransports, type PushConfig } from "./config";
import { PUSH_KINDS } from "./kinds";
import type { PushData } from "./message";

/**
 * Turns "this person should hear about this" into one delivery per device.
 * Shared by the outbox fan-out and the recurring reminders. It applies, in
 * order:
 * 1. the person's preferences: a type whose push switch is off does not push
 *    (a type with no stored row pushes);
 * 2. a cap on how many different pushes one person gets per hour, so a bulk
 *    write or a loop cannot flood a phone;
 * 3. the devices: only transports that have a sender, only active users and
 *    credentials that have not lapsed, and for an address registered by two
 *    accounts (one phone, two sign-ins) only the account that used it last.
 * A delivery is unique per device and dedupe key, so running the same
 * fan-out twice sends nothing twice.
 */

export const MAX_PUSHES_PER_USER_PER_HOUR = 60;
const HOUR_MS = 60 * 60 * 1000;

export type PushDraft = {
	userId: string;
	data: PushData;
	/** What the push is for; the same key never pushes twice to a device. */
	dedupeKey: string;
	eventId: string | null;
};

type Writer = Pick<
	Prisma.TransactionClient,
	"notificationPreference" | "pushDevice" | "pushDelivery" | "$queryRaw"
>;

async function withoutMutedTypes(
	tx: Writer,
	drafts: PushDraft[],
): Promise<PushDraft[]> {
	const muted = await tx.notificationPreference.findMany({
		where: {
			push: false,
			OR: drafts.map((d) => ({
				userId: d.userId,
				type: PUSH_KINDS[d.data.type].preference,
			})),
		},
		select: { userId: true, type: true },
	});
	const mutedKeys = new Set(muted.map((m) => `${m.userId}:${m.type}`));
	return drafts.filter(
		(d) => !mutedKeys.has(`${d.userId}:${PUSH_KINDS[d.data.type].preference}`),
	);
}

async function withinRateLimit(
	tx: Writer,
	drafts: PushDraft[],
	since: Date,
): Promise<PushDraft[]> {
	const userIds = [...new Set(drafts.map((d) => d.userId))];
	if (userIds.length === 0) return drafts;
	const rows = await tx.$queryRaw<{ userId: string; n: number }[]>`
		SELECT "userId", COUNT(DISTINCT "dedupeKey")::int AS "n" FROM "push_delivery"
		WHERE "createdAt" > ${since} AND "userId" = ANY(${userIds})
		GROUP BY "userId"`;
	const used = new Map(rows.map((r) => [r.userId, r.n]));
	return drafts.filter((d) => {
		const n = used.get(d.userId) ?? 0;
		if (n >= MAX_PUSHES_PER_USER_PER_HOUR) return false;
		used.set(d.userId, n + 1);
		return true;
	});
}

/**
 * The devices to use: enabled transports, active users, a credential that is
 * still good (a row goes with its session or key when that is deleted, but an
 * expired or disabled one keeps its row until cleanup), and the newest
 * account for an address.
 */
async function usableDevices(
	tx: Pick<Writer, "pushDevice">,
	userIds: string[],
	transports: PushDevice["transport"][],
	now: Date,
): Promise<PushDevice[]> {
	if (userIds.length === 0 || transports.length === 0) return [];
	const devices = await tx.pushDevice.findMany({
		where: {
			userId: { in: userIds },
			transport: { in: transports },
			user: { isActive: true },
			AND: [
				{ OR: [{ sessionId: null }, { session: { expiresAt: { gt: now } } }] },
				{
					OR: [
						{ apiKeyId: null },
						{
							apiKey: {
								enabled: { not: false },
								OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
							},
						},
					],
				},
			],
		},
	});
	const rivals = await tx.pushDevice.findMany({
		where: { addressHash: { in: devices.map((d) => d.addressHash) } },
		select: { id: true, transport: true, addressHash: true, lastSeenAt: true },
	});
	const newest = new Map<string, { id: string; seen: number }>();
	for (const r of rivals) {
		const key = `${r.transport}:${r.addressHash}`;
		const seen = r.lastSeenAt.getTime();
		const best = newest.get(key);
		if (!best || seen > best.seen || (seen === best.seen && r.id > best.id))
			newest.set(key, { id: r.id, seen });
	}
	return devices.filter(
		(d) => newest.get(`${d.transport}:${d.addressHash}`)?.id === d.id,
	);
}

/**
 * Whether `device` would still be chosen today: its user active, its session
 * or key not lapsed, and no other account having used its address more
 * recently. The worker asks this before every attempt, so a retry never
 * reaches a phone that has changed hands.
 */
export async function isDeviceUsable(
	tx: Pick<Writer, "pushDevice">,
	device: Pick<PushDevice, "id" | "userId" | "transport">,
	now: Date,
): Promise<boolean> {
	const usable = await usableDevices(
		tx,
		[device.userId],
		[device.transport],
		now,
	);
	return usable.some((d) => d.id === device.id);
}

/** Writes the deliveries for `drafts`. Returns how many it created. */
export async function enqueuePushes(
	tx: Writer,
	config: PushConfig,
	drafts: PushDraft[],
	now: Date,
): Promise<number> {
	const transports = enabledTransports(config);
	if (drafts.length === 0 || transports.length === 0) return 0;
	const wanted = await withoutMutedTypes(tx, drafts);
	const allowed = await withinRateLimit(
		tx,
		wanted,
		new Date(now.getTime() - HOUR_MS),
	);
	const devices = await usableDevices(
		tx,
		[...new Set(allowed.map((d) => d.userId))],
		transports,
		now,
	);
	const byUser = new Map<string, PushDevice[]>();
	for (const d of devices)
		byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d]);
	const rows: Prisma.PushDeliveryCreateManyInput[] = allowed.flatMap((d) =>
		(byUser.get(d.userId) ?? []).map((device) => ({
			userId: d.userId,
			deviceId: device.id,
			eventId: d.eventId,
			eventType: d.data.type,
			channel: d.data.channel,
			dedupeKey: d.dedupeKey,
			payload: d.data as unknown as Prisma.InputJsonValue,
			nextAttemptAt: now,
		})),
	);
	if (rows.length === 0) return 0;
	const { count } = await tx.pushDelivery.createMany({
		data: rows,
		skipDuplicates: true,
	});
	return count;
}
