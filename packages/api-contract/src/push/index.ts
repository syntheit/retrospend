import * as z from "zod";
import { v1 } from "../common/meta";
import { cursorQuerySchema, pageOf } from "../common/pagination";
import { idParamsSchema, idSchema, okSchema, timestampSchema } from "../core";

export const PUSH_PLATFORMS = ["ios", "android"] as const;

const deviceFields = {
	appVersion: z.string().max(32).optional(),
	deviceName: z.string().trim().max(100).optional(),
};

/** Web Push key material, base64url as the Push API hands it out. */
const base64url = (max: number) =>
	z
		.string()
		.min(16)
		.max(max)
		.regex(/^[A-Za-z0-9_-]+={0,2}$/);

export const registerPushDeviceSchema = z
	.discriminatedUnion("transport", [
		z.object({
			transport: z.literal("apns"),
			platform: z.literal("ios"),
			/** The APNs device token, hex. */
			token: z
				.string()
				.min(32)
				.max(200)
				.regex(/^[0-9a-fA-F]+$/),
			/** Development builds register with the APNs sandbox. */
			apnsSandbox: z.boolean().optional(),
			...deviceFields,
		}),
		z.object({
			transport: z.literal("fcm"),
			platform: z.enum(PUSH_PLATFORMS),
			token: z.string().min(1).max(4096),
			...deviceFields,
		}),
		z.object({
			transport: z.literal("unifiedpush"),
			platform: z.literal("android"),
			/** The distributor's endpoint. Must be https. */
			endpoint: z.url({ protocol: /^https$/ }).max(2048),
			keys: z.object({ p256dh: base64url(255), auth: base64url(64) }),
			...deviceFields,
		}),
	])
	.meta({ id: "RegisterPushDevice" });

export type RegisterPushDevice = z.infer<typeof registerPushDeviceSchema>;

/** A registered device. Tokens, endpoints and keys are never echoed back. */
export const pushDeviceSchema = z
	.object({
		id: idSchema,
		platform: z.enum(PUSH_PLATFORMS),
		transport: z.enum(["apns", "fcm", "unifiedpush"]),
		apnsSandbox: z.boolean(),
		appVersion: z.string().nullable(),
		deviceName: z.string().nullable(),
		lastSeenAt: timestampSchema,
		createdAt: timestampSchema,
	})
	.meta({ id: "PushDevice" });

export type PushDeviceDto = z.infer<typeof pushDeviceSchema>;

const TAG = ["Push"];

export const pushContract = {
	list: v1
		.route({
			method: "GET",
			path: "/push-devices",
			operationId: "listPushDevices",
			tags: TAG,
			summary: "Devices registered for push, most recently seen first",
		})
		.meta({ scope: "read" })
		.input(cursorQuerySchema)
		.output(pageOf(pushDeviceSchema)),
	register: v1
		.route({
			method: "POST",
			path: "/push-devices",
			operationId: "registerPushDevice",
			tags: TAG,
			summary: "Register or refresh this device's push address",
			description:
				"Sending an address the caller already registered updates that device and its lastSeenAt.",
		})
		.meta({ scope: "write:settings", event: "push_device.registered" })
		.input(registerPushDeviceSchema)
		.output(pushDeviceSchema),
	remove: v1
		.route({
			method: "DELETE",
			path: "/push-devices/{id}",
			operationId: "removePushDevice",
			tags: TAG,
			summary: "Stop pushing to a device",
		})
		.meta({ scope: "write:settings", event: "push_device.removed" })
		.input(idParamsSchema)
		.output(okSchema),
};
