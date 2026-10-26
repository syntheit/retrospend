import { createECDH, createPrivateKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "~/env";
import { parseAllowHosts } from "~/server/services/push-endpoint";
import type { PushTransport } from "~prisma";

/**
 * Which push senders this server can run. Each sender needs its own
 * settings; one with missing or unreadable settings is simply off, so a
 * server without any push setup (the default) behaves as before, and a
 * bad value in one sender never stops the others. Problems are logged once
 * with the name of the setting, never its value.
 */

export type ApnsConfig = {
	keyId: string;
	teamId: string;
	bundleId: string;
	privateKey: KeyObject;
	/** Where to connect, by the device's registration. Overridden in tests. */
	productionUrl: string;
	sandboxUrl: string;
};

export type WebPushConfig = {
	/** The VAPID public key, base64url of the 65-byte point. */
	publicKey: string;
	privateKey: KeyObject;
	/** `mailto:` or `https:` contact the push service may use. */
	subject: string;
};

export type FcmConfig = {
	projectId: string;
	clientEmail: string;
	privateKey: KeyObject;
	tokenUrl: string;
	apiBaseUrl: string;
};

export type PushConfig = {
	apns?: ApnsConfig;
	webPush?: WebPushConfig;
	fcm?: FcmConfig;
	/** Hosts the operator trusts although they are private (PUSH_ENDPOINT_ALLOW_HOSTS). */
	allowHosts: ReadonlySet<string>;
};

export type PushEnv = {
	APNS_KEY_ID?: string;
	APNS_TEAM_ID?: string;
	APNS_BUNDLE_ID?: string;
	APNS_KEY?: string;
	APNS_KEY_FILE?: string;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	VAPID_SUBJECT?: string;
	FCM_PROJECT_ID?: string;
	FCM_SERVICE_ACCOUNT?: string;
	FCM_SERVICE_ACCOUNT_FILE?: string;
	PUSH_ENDPOINT_ALLOW_HOSTS?: string;
	PUBLIC_URL?: string;
};

const APNS_PRODUCTION = "https://api.push.apple.com";
const APNS_SANDBOX = "https://api.sandbox.push.apple.com";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_API = "https://fcm.googleapis.com";

function warn(setting: string, problem: string): void {
	console.error(`Push: ${setting} ${problem}; that sender is off.`);
}

/** A secret given inline or as a file path. */
function readSecret(inline?: string, file?: string): string | undefined {
	if (inline) return inline;
	if (!file) return undefined;
	try {
		return readFileSync(file, "utf8");
	} catch {
		return undefined;
	}
}

function loadApns(source: PushEnv): ApnsConfig | undefined {
	const { APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId } = source;
	const bundleId = source.APNS_BUNDLE_ID;
	// An env file keeps a key on one line, with newlines written as \n.
	const pem = readSecret(source.APNS_KEY, source.APNS_KEY_FILE)?.replaceAll(
		"\\n",
		"\n",
	);
	if (!keyId && !teamId && !bundleId && !pem) return undefined;
	if (!keyId || !teamId || !bundleId || !pem) {
		warn(
			"APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID and APNS_KEY",
			"are not all set",
		);
		return undefined;
	}
	try {
		const privateKey = createPrivateKey(pem);
		if (privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1")
			throw new Error("not a P-256 key");
		return {
			keyId,
			teamId,
			bundleId,
			privateKey,
			productionUrl: APNS_PRODUCTION,
			sandboxUrl: APNS_SANDBOX,
		};
	} catch {
		warn("APNS_KEY", "is not a P-256 .p8 key");
		return undefined;
	}
}

function loadWebPush(source: PushEnv): WebPushConfig | undefined {
	const raw = source.VAPID_PRIVATE_KEY;
	if (!raw) return undefined;
	const subject =
		source.VAPID_SUBJECT ??
		(source.PUBLIC_URL?.startsWith("https:") ? source.PUBLIC_URL : undefined);
	if (!subject || !/^(mailto:|https:\/\/)/.test(subject)) {
		warn("VAPID_SUBJECT", "must be a mailto: or https: address");
		return undefined;
	}
	try {
		const d = Buffer.from(raw, "base64url");
		if (d.length !== 32) throw new Error("length");
		const ecdh = createECDH("prime256v1");
		ecdh.setPrivateKey(d);
		const point = ecdh.getPublicKey();
		const publicKey = point.toString("base64url");
		if (source.VAPID_PUBLIC_KEY && source.VAPID_PUBLIC_KEY !== publicKey) {
			warn("VAPID_PUBLIC_KEY", "does not belong to VAPID_PRIVATE_KEY");
			return undefined;
		}
		const privateKey = createPrivateKey({
			format: "jwk",
			key: {
				kty: "EC",
				crv: "P-256",
				d: raw,
				x: point.subarray(1, 33).toString("base64url"),
				y: point.subarray(33, 65).toString("base64url"),
			},
		});
		return { publicKey, privateKey, subject };
	} catch {
		warn("VAPID_PRIVATE_KEY", "is not a base64url P-256 private key");
		return undefined;
	}
}

function loadFcm(source: PushEnv): FcmConfig | undefined {
	const json = readSecret(
		source.FCM_SERVICE_ACCOUNT,
		source.FCM_SERVICE_ACCOUNT_FILE,
	);
	if (!json && !source.FCM_PROJECT_ID) return undefined;
	if (!json) {
		warn("FCM_SERVICE_ACCOUNT", "is not set");
		return undefined;
	}
	try {
		const account = JSON.parse(json) as {
			client_email?: unknown;
			private_key?: unknown;
			project_id?: unknown;
		};
		const projectId =
			source.FCM_PROJECT_ID ??
			(typeof account.project_id === "string" ? account.project_id : "");
		if (
			typeof account.client_email !== "string" ||
			typeof account.private_key !== "string" ||
			!projectId
		)
			throw new Error("fields");
		return {
			projectId,
			clientEmail: account.client_email,
			privateKey: createPrivateKey(account.private_key),
			tokenUrl: GOOGLE_TOKEN_URL,
			apiBaseUrl: FCM_API,
		};
	} catch {
		warn("FCM_SERVICE_ACCOUNT", "is not a service account key");
		return undefined;
	}
}

export function loadPushConfig(source: PushEnv = env): PushConfig {
	return {
		apns: loadApns(source),
		webPush: loadWebPush(source),
		fcm: loadFcm(source),
		allowHosts: parseAllowHosts(source.PUSH_ENDPOINT_ALLOW_HOSTS),
	};
}

let cached: PushConfig | undefined;

/** The server's own config, read once. */
export function pushConfig(): PushConfig {
	cached ??= loadPushConfig();
	return cached;
}

/** The transports that have a sender, as the database names them. */
export function enabledTransports(config: PushConfig): PushTransport[] {
	const out: PushTransport[] = [];
	if (config.apns) out.push("APNS");
	if (config.fcm) out.push("FCM");
	if (config.webPush) out.push("UNIFIEDPUSH");
	return out;
}
