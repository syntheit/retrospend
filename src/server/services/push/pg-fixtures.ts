/**
 * Seeds and fakes for the push pg tests: devices written straight to the
 * database, events as the outbox holds them, and senders that record what
 * they were given and answer as told.
 */
import { randomUUID } from "node:crypto";
import { addressHash } from "~/server/services/push-device.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import type { PushTransport } from "~prisma";
import { loadPushConfig, type PushConfig } from "./config";
import type {
	PushMessage,
	PushSender,
	PushTarget,
	SendOutcome,
} from "./senders";
import {
	newApnsKey,
	newServiceAccount,
	newSubscription,
	newVapidEnv,
} from "./test-helpers";

export { adminDb, createTestUser };

/** Every sender on, with throwaway keys. */
export function allSendersConfig(
	extra: Record<string, string> = {},
): PushConfig {
	return loadPushConfig({
		APNS_KEY_ID: "KEY1234567",
		APNS_TEAM_ID: "TEAM123456",
		APNS_BUNDLE_ID: "io.example.retrospend",
		APNS_KEY: newApnsKey().pem,
		FCM_SERVICE_ACCOUNT: newServiceAccount().json,
		...newVapidEnv(),
		...extra,
	});
}

export async function addDevice(
	userId: string,
	transport: PushTransport = "APNS",
	over: { address?: string; lastSeenAt?: Date; apnsSandbox?: boolean } = {},
) {
	const address = over.address ?? randomUUID().replaceAll("-", "").repeat(2);
	const sub = newSubscription();
	const device = await adminDb.pushDevice.create({
		data:
			transport === "UNIFIEDPUSH"
				? {
						userId,
						transport,
						platform: "ANDROID",
						endpoint: address,
						p256dh: sub.p256dh,
						auth: sub.auth,
						addressHash: addressHash({
							transport,
							endpoint: address,
							p256dh: sub.p256dh,
							auth: sub.auth,
						}),
						lastSeenAt: over.lastSeenAt,
					}
				: {
						userId,
						transport,
						platform: transport === "APNS" ? "IOS" : "ANDROID",
						token: address,
						apnsSandbox: over.apnsSandbox ?? false,
						addressHash: addressHash({ transport, token: address }),
						lastSeenAt: over.lastSeenAt,
					},
	});
	return { device, subscription: sub };
}

/** An outbox event as a write by `actor` leaves it. */
export function appendOutboxEvent(
	actor: string,
	type: string,
	entityId: string | null,
	over: { createdAt?: Date } = {},
) {
	return adminDb.apiEvent.create({
		data: {
			userId: actor,
			actorUserId: actor,
			type,
			entityType: entityId ? type.split(".")[0] : null,
			entityId,
			payload: { ids: {}, amounts: [], truncated: false },
			...over,
		},
	});
}

export type Sent = { target: PushTarget; message: PushMessage };

/**
 * Senders for every transport that record each send and answer with
 * `answer(target, message)` (sent by default).
 */
export function recordingSenders(
	answer: (target: PushTarget, message: PushMessage) => SendOutcome = () => ({
		kind: "sent",
		statusCode: 200,
	}),
) {
	const sent: Sent[] = [];
	const sender: PushSender = {
		close() {},
		async send(target, message) {
			sent.push({ target, message });
			return answer(target, message);
		},
	};
	return {
		sent,
		senders: { APNS: sender, FCM: sender, UNIFIEDPUSH: sender } as Record<
			PushTransport,
			PushSender
		>,
	};
}

export const deliveriesOf = (userId: string) =>
	adminDb.pushDelivery.findMany({
		where: { userId },
		orderBy: { createdAt: "asc" },
	});

/**
 * Runs `sweep` until every outbox event has been looked at. An event shows
 * only once the oldest open transaction is behind it (feed.ts), and a
 * neighboring test's background write can briefly hold that back, so a
 * single sweep right after a write may see nothing yet. The real worker
 * re-arms after two seconds for the same reason.
 */
export async function sweepUntilPushed(sweep: () => Promise<unknown>) {
	for (let n = 0; n < 50; n++) {
		await sweep();
		if ((await adminDb.apiEvent.count({ where: { pushedAt: null } })) === 0)
			return;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error("The push fan-out never saw every event");
}
