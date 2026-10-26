/**
 * Shared by the push tests: a device's key pair, the receiving side of Web
 * Push (written separately from the sender's code, from the RFC), key
 * generators for the three services and a mock HTTP server.
 */
import {
	createDecipheriv,
	createECDH,
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	hkdfSync,
	type KeyObject,
	randomBytes,
	verify,
} from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { PushConfig } from "./config";

/** What a Web Push subscription holds, and the private half only the device has. */
export function newSubscription() {
	const ecdh = createECDH("prime256v1");
	ecdh.generateKeys();
	const authSecret = randomBytes(16);
	return {
		privateKey: ecdh.getPrivateKey(),
		p256dh: ecdh.getPublicKey().toString("base64url"),
		auth: authSecret.toString("base64url"),
	};
}

function hkdf(ikm: Buffer, salt: Buffer, info: Buffer, length: number) {
	return Buffer.from(hkdfSync("sha256", ikm, salt, info, length));
}

/** RFC 8291 section 3.4 and RFC 8188: what the device does with a push body. */
export function decryptWebPush(
	body: Buffer,
	sub: { privateKey: Buffer; p256dh: string; auth: string },
): Buffer {
	const salt = body.subarray(0, 16);
	const recordSize = body.readUInt32BE(16);
	const idLength = body[20] ?? 0;
	const asPublic = body.subarray(21, 21 + idLength);
	const ciphertext = body.subarray(21 + idLength);
	if (ciphertext.length > recordSize) throw new Error("more than one record");

	const ua = createECDH("prime256v1");
	ua.setPrivateKey(sub.privateKey);
	const secret = ua.computeSecret(asPublic);
	const uaPublic = Buffer.from(sub.p256dh, "base64url");
	const ikm = hkdf(
		secret,
		Buffer.from(sub.auth, "base64url"),
		Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]),
		32,
	);
	const key = hkdf(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
	const nonce = hkdf(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
	const decipher = createDecipheriv("aes-128-gcm", key, nonce);
	decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
	const padded = Buffer.concat([
		decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
		decipher.final(),
	]);
	// Strip the padding: zeros after the last-record delimiter 0x02.
	let end = padded.length;
	while (end > 0 && padded[end - 1] === 0) end -= 1;
	if (padded[end - 1] !== 2) throw new Error("not the last record");
	return padded.subarray(0, end - 1);
}

/** A VAPID key pair as the env holds it. */
export function newVapidEnv(subject = "mailto:ops@example.test") {
	const ecdh = createECDH("prime256v1");
	ecdh.generateKeys();
	return {
		VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString("base64url"),
		VAPID_PRIVATE_KEY: ecdh.getPrivateKey().toString("base64url"),
		VAPID_SUBJECT: subject,
	};
}

/** A P-256 key in the .p8 format Apple hands out. */
export function newApnsKey(): { pem: string; publicKey: KeyObject } {
	const { privateKey, publicKey } = generateKeyPairSync("ec", {
		namedCurve: "prime256v1",
	});
	return {
		pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		publicKey,
	};
}

/** A Google service account key file for tests. */
export function newServiceAccount(projectId = "demo-project") {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
	});
	return {
		json: JSON.stringify({
			type: "service_account",
			project_id: projectId,
			client_email: `push@${projectId}.iam.example.test`,
			private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
		}),
		publicKey,
	};
}

export function decodeJwt(jwt: string) {
	const [header, claims, signature] = jwt.split(".");
	return {
		header: JSON.parse(Buffer.from(header ?? "", "base64url").toString()),
		claims: JSON.parse(Buffer.from(claims ?? "", "base64url").toString()),
		signingInput: `${header}.${claims}`,
		signature: Buffer.from(signature ?? "", "base64url"),
	};
}

export function verifyJwt(
	jwt: string,
	alg: "ES256" | "RS256",
	publicKey: KeyObject,
): boolean {
	const { signingInput, signature } = decodeJwt(jwt);
	return alg === "ES256"
		? verify(
				"sha256",
				Buffer.from(signingInput),
				{
					key: publicKey,
					dsaEncoding: "ieee-p1363",
				},
				signature,
			)
		: verify("sha256", Buffer.from(signingInput), publicKey, signature);
}

/** The public half of a PEM private key, for checking a signature. */
export function publicKeyOf(pem: string): KeyObject {
	return createPublicKey(createPrivateKey(pem));
}

export type Seen = {
	method: string;
	url: string;
	headers: IncomingMessage["headers"];
	body: Buffer;
};

export type MockReply = {
	status: number;
	body?: string;
	headers?: Record<string, string>;
};

/** A local HTTP server that records requests and answers with `reply(seen)`. */
export async function mockHttp(
	reply: (seen: Seen) => MockReply,
): Promise<{ url: string; seen: Seen[]; close: () => Promise<void> }> {
	const seen: Seen[] = [];
	const server: Server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => {
			const entry: Seen = {
				method: req.method ?? "",
				url: req.url ?? "",
				headers: req.headers,
				body: Buffer.concat(chunks),
			};
			seen.push(entry);
			const out = reply(entry);
			res.writeHead(out.status, out.headers);
			res.end(out.body ?? "");
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		seen,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

/** A config with no sender: the base tests add what they need. */
export const NO_PUSH: PushConfig = { allowHosts: new Set() };
