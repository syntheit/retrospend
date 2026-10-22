import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { db as globalDb } from "~/server/db";
import type { PushDevice, PushPlatform, PushTransport } from "~prisma";

type AppDb = typeof globalDb;

/**
 * Push devices (M12): the addresses the push fan-out sends to. A device
 * registers again on every app start, so registering an address the user
 * already has refreshes that row (lastSeenAt, app version) rather than
 * adding a second one. Callers pass a user-scoped client.
 *
 * The same address registered by two users (one phone, two accounts in
 * turn) gives two rows; the fan-out should send only to the row seen most
 * recently for an address.
 */

export type PushAddress =
	| { transport: "APNS" | "FCM"; token: string }
	| {
			transport: "UNIFIEDPUSH";
			endpoint: string;
			p256dh: string;
			auth: string;
	  };

export type PushRegistration = PushAddress & {
	platform: PushPlatform;
	apnsSandbox?: boolean;
	appVersion?: string;
	deviceName?: string;
};

export function addressHash(address: PushAddress): string {
	const value =
		address.transport === "UNIFIEDPUSH" ? address.endpoint : address.token;
	return createHash("sha256").update(value).digest("hex");
}

/** Platforms a transport can serve: APNs is iOS only, UnifiedPush Android only. */
const PLATFORMS: Record<PushTransport, PushPlatform[]> = {
	APNS: ["IOS"],
	FCM: ["IOS", "ANDROID"],
	UNIFIEDPUSH: ["ANDROID"],
};

export async function registerPushDevice(
	db: AppDb,
	userId: string,
	input: PushRegistration,
): Promise<PushDevice> {
	if (!PLATFORMS[input.transport].includes(input.platform)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `${input.transport} does not serve ${input.platform}`,
		});
	}
	const hash = addressHash(input);
	const fields = {
		platform: input.platform,
		token: input.transport === "UNIFIEDPUSH" ? null : input.token,
		endpoint: input.transport === "UNIFIEDPUSH" ? input.endpoint : null,
		p256dh: input.transport === "UNIFIEDPUSH" ? input.p256dh : null,
		auth: input.transport === "UNIFIEDPUSH" ? input.auth : null,
		apnsSandbox: input.transport === "APNS" && (input.apnsSandbox ?? false),
		appVersion: input.appVersion ?? null,
		deviceName: input.deviceName ?? null,
		lastSeenAt: new Date(),
	};
	return db.pushDevice.upsert({
		where: {
			userId_transport_addressHash: {
				userId,
				transport: input.transport,
				addressHash: hash,
			},
		},
		create: {
			userId,
			transport: input.transport,
			addressHash: hash,
			...fields,
		},
		update: fields,
	});
}

/** Most recently seen first (ties by id), starting after `after`. */
export function listPushDevices(
	db: AppDb,
	userId: string,
	page: { after: { lastSeenAt: Date; id: string } | null; take: number },
): Promise<PushDevice[]> {
	const { after } = page;
	return db.pushDevice.findMany({
		where: {
			userId,
			...(after
				? {
						OR: [
							{ lastSeenAt: { lt: after.lastSeenAt } },
							{ lastSeenAt: after.lastSeenAt, id: { lt: after.id } },
						],
					}
				: {}),
		},
		orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
		take: page.take,
	});
}

/** Removes a device; false when the caller has no such device. */
export async function removePushDevice(
	db: AppDb,
	userId: string,
	id: string,
): Promise<boolean> {
	const { count } = await db.pushDevice.deleteMany({ where: { id, userId } });
	return count > 0;
}
