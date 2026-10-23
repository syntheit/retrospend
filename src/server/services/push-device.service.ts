import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import type {
	PrismaClient,
	PushDevice,
	PushPlatform,
	PushTransport,
} from "~prisma";
import { isAllowedPushEndpoint, parseAllowHosts } from "./push-endpoint";

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
 *
 * Each row records the session or API key that registered it, and the
 * database deletes the row with that credential (sign out, revoke), so a
 * signed-out phone stops getting pushes.
 */

/** Most devices one user keeps; a new one beyond this drops the least recently seen. */
export const MAX_PUSH_DEVICES = 20;

/** The credential a registration came with. */
export type PushCredential = { sessionId: string } | { apiKeyId: string };

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

function assertRegistrable(input: PushRegistration) {
	if (!PLATFORMS[input.transport].includes(input.platform)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `${input.transport} does not serve ${input.platform}`,
		});
	}
	if (
		input.transport === "UNIFIEDPUSH" &&
		!isAllowedPushEndpoint(
			input.endpoint,
			parseAllowHosts(env.PUSH_ENDPOINT_ALLOW_HOSTS),
		)
	) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "The push endpoint must use a public host name",
		});
	}
}

/**
 * Registers or refreshes a device in one transaction with RLS for
 * `userId`, then trims the user's devices to MAX_PUSH_DEVICES. `client` is
 * the root client: a user-scoped one runs each query in its own
 * transaction, which would split the cap check from the write.
 */
export async function registerPushDevice(
	client: Pick<PrismaClient, "$transaction">,
	userId: string,
	input: PushRegistration,
	credential: PushCredential,
): Promise<PushDevice> {
	assertRegistrable(input);
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
		sessionId: "sessionId" in credential ? credential.sessionId : null,
		apiKeyId: "apiKeyId" in credential ? credential.apiKeyId : null,
		lastSeenAt: new Date(),
	};
	return userTransaction(client, userId, async (tx) => {
		// Two registrations at once must not both see room for one more.
		await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`push_device:${userId}`}, 0))`;
		const device = await tx.pushDevice.upsert({
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
		const beyondCap = await tx.pushDevice.findMany({
			where: { userId },
			orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
			skip: MAX_PUSH_DEVICES,
			select: { id: true },
		});
		if (beyondCap.length > 0) {
			await tx.pushDevice.deleteMany({
				where: { id: { in: beyondCap.map((d) => d.id) } },
			});
		}
		return device;
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
