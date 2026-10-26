import type { PushTransport } from "~prisma";
import type { PushConfig } from "../config";
import { createApnsSender } from "./apns";
import { createFcmSender } from "./fcm";
import type { PushSender } from "./types";
import { createWebPushSender, type WebPushOptions } from "./webpush";

export type SenderOptions = {
	webPush: WebPushOptions;
	timeoutMs?: number;
	now?: () => Date;
};

/** The senders this config can run, by the transport they serve. */
export function createSenders(
	config: PushConfig,
	options: SenderOptions,
): Partial<Record<PushTransport, PushSender>> {
	const { timeoutMs, now } = options;
	return {
		...(config.apns && {
			APNS: createApnsSender(config.apns, { timeoutMs, now }),
		}),
		...(config.fcm && { FCM: createFcmSender(config.fcm, { timeoutMs, now }) }),
		...(config.webPush && {
			UNIFIEDPUSH: createWebPushSender(config.webPush, {
				timeoutMs,
				now,
				...options.webPush,
			}),
		}),
	};
}

export type { PushMessage, PushSender, PushTarget, SendOutcome } from "./types";
