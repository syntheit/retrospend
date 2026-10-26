import type { PushChannel } from "../kinds";

/**
 * What goes to a device: the localized text, and the machine part the app
 * reads when it opens or wakes (ids and an amount, never a title or note).
 */
export type PushMessage = {
	title: string;
	body: string;
	channel: PushChannel;
	/** JSON-safe data for the app; see PushData in ../message.ts. */
	data: Record<string, unknown>;
	/** Seconds the push service may hold it for an offline device. */
	ttlSeconds: number;
};

/** A device row, narrowed to what a sender needs. */
export type PushTarget = {
	id: string;
	transport: "APNS" | "FCM" | "UNIFIEDPUSH";
	token: string | null;
	endpoint: string | null;
	p256dh: string | null;
	auth: string | null;
	apnsSandbox: boolean;
};

/**
 * How a send ended, as a short code, never a response body.
 * - sent: the push service accepted it.
 * - dead: the address will never work again (uninstalled, token revoked).
 * - retry: try again later; `retryAfterMs` is the service's own hint.
 * - failed: do not try again (a bad payload or a setting problem).
 */
export type SendOutcome =
	| { kind: "sent"; statusCode: number }
	| { kind: "dead"; statusCode: number | null; code: string }
	| {
			kind: "retry";
			statusCode: number | null;
			code: string;
			retryAfterMs?: number;
	  }
	| { kind: "failed"; statusCode: number | null; code: string };

export type PushSender = {
	send(target: PushTarget, message: PushMessage): Promise<SendOutcome>;
	/** Releases connections held between sends. */
	close(): void;
};
