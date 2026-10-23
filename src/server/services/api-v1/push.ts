import type {
	CursorQuery,
	PushDeviceDto,
	RegisterPushDevice,
} from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import { db } from "~/server/db";
import {
	listPushDevices,
	type PushRegistration,
	registerPushDevice,
	removePushDevice,
} from "~/server/services/push-device.service";
import type { PushDevice } from "~prisma";
import type { Caller } from "./caller";
import { decodeCursor, toPage } from "./cursor";

/** v1 adapters for /push-devices: lowercase wire names, enum values in the db. */

function toDto(row: PushDevice): PushDeviceDto {
	return {
		id: row.id,
		platform: row.platform === "IOS" ? "ios" : "android",
		transport:
			row.transport === "APNS"
				? "apns"
				: row.transport === "FCM"
					? "fcm"
					: "unifiedpush",
		apnsSandbox: row.apnsSandbox,
		appVersion: row.appVersion,
		deviceName: row.deviceName,
		lastSeenAt: row.lastSeenAt.toISOString(),
		createdAt: row.createdAt.toISOString(),
	};
}

function toRegistration(input: RegisterPushDevice): PushRegistration {
	const device = {
		platform:
			input.platform === "ios" ? ("IOS" as const) : ("ANDROID" as const),
		appVersion: input.appVersion,
		deviceName: input.deviceName,
	};
	switch (input.transport) {
		case "apns":
			return {
				...device,
				transport: "APNS",
				token: input.token.toLowerCase(),
				apnsSandbox: input.apnsSandbox,
			};
		case "fcm":
			return { ...device, transport: "FCM", token: input.token };
		case "unifiedpush":
			return {
				...device,
				transport: "UNIFIEDPUSH",
				endpoint: input.endpoint,
				p256dh: input.keys.p256dh,
				auth: input.keys.auth,
			};
	}
}

export async function register(caller: Caller, input: RegisterPushDevice) {
	const { kind, tokenId, userId } = caller.principal;
	return toDto(
		await registerPushDevice(
			db,
			userId,
			toRegistration(input),
			kind === "apiKey" ? { apiKeyId: tokenId } : { sessionId: tokenId },
		),
	);
}

const seenCursor = z.object({ lastSeenAt: z.iso.datetime(), id: z.string() });

export async function listDevicePage(caller: Caller, q: CursorQuery) {
	const after = decodeCursor(q.cursor, seenCursor);
	const rows = await listPushDevices(caller.db, caller.principal.userId, {
		after: after
			? { lastSeenAt: new Date(after.lastSeenAt), id: after.id }
			: null,
		take: q.limit + 1,
	});
	return toPage(
		rows,
		q.limit,
		(d) => ({ lastSeenAt: d.lastSeenAt.toISOString(), id: d.id }),
		toDto,
	);
}

export async function remove(caller: Caller, id: string) {
	if (!(await removePushDevice(caller.db, caller.principal.userId, id))) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Push device not found",
		});
	}
	return { ok: true as const };
}
