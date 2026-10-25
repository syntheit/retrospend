import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Where a webhook may point (decided: refuse by default). The server POSTs
 * to a URL a user typed, so by default it refuses any target that resolves
 * to a loopback, private, link-local, carrier-grade NAT, multicast or
 * reserved address, which includes the cloud metadata address
 * 169.254.169.254. The check runs on the addresses a name resolves to, at
 * create and again before every delivery, and the delivery connects to the
 * addresses it just checked (see send.ts), so a name cannot answer public
 * once and private the next time. An admin setting turns the block off for
 * self-hosters (a LAN receiver); https is required unless it is on.
 */

export type TargetErrorCode =
	| "invalid_url"
	| "https_required"
	| "credentials_not_allowed"
	| "blocked_target"
	| "unresolvable";

export class WebhookTargetError extends Error {
	constructor(
		readonly code: TargetErrorCode,
		message: string,
	) {
		super(message);
		this.name = "WebhookTargetError";
	}
}

export type Resolver = (hostname: string) => Promise<string[]>;

export const resolveAll: Resolver = async (hostname) => {
	const found = await lookup(hostname, { all: true, verbatim: true });
	return found.map((a) => a.address);
};

type V4 = readonly [number, number, number, number];

function parseV4(ip: string): V4 | null {
	const parts = ip.split(".");
	if (parts.length !== 4) return null;
	const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
	if (nums.some((n) => !(n >= 0 && n <= 255))) return null;
	return nums as unknown as V4;
}

function blockedV4([a, b, c]: V4): boolean {
	return (
		a === 0 || // "this network"
		a === 10 ||
		(a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
		a === 127 ||
		(a === 169 && b === 254) || // link-local, cloud metadata
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0 && (c === 0 || c === 2)) ||
		(a === 192 && b === 88 && c === 99) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113) ||
		a >= 224 // multicast, reserved, broadcast
	);
}

/** The eight 16-bit groups of an IPv6 address, or null if it is not one. */
function parseV6(ip: string): number[] | null {
	let text = ip.toLowerCase();
	const zone = text.indexOf("%");
	if (zone >= 0) text = text.slice(0, zone);
	// An embedded dotted quad takes the place of the last two groups.
	const lastColon = text.lastIndexOf(":");
	if (text.includes(".")) {
		const v4 = parseV4(text.slice(lastColon + 1));
		if (!v4) return null;
		text = `${text.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
	}
	const halves = text.split("::");
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(":") : [];
	const tail = halves[1] ? halves[1].split(":") : [];
	const missing = 8 - head.length - tail.length;
	if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
	const groups = [
		...head,
		...Array(halves.length === 2 ? missing : 0).fill("0"),
		...tail,
	];
	const nums = groups.map((g) =>
		/^[0-9a-f]{1,4}$/.test(g) ? Number.parseInt(g, 16) : NaN,
	);
	return nums.length === 8 && nums.every((n) => n >= 0) ? nums : null;
}

function v4OfGroups(hi: number, lo: number): V4 {
	return [hi >> 8, hi & 255, lo >> 8, lo & 255];
}

function blockedV6(g: number[]): boolean {
	const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [
		number,
		number,
		number,
		number,
		number,
		number,
		number,
		number,
	];
	if (g.slice(0, 6).every((n) => n === 0)) return true; // ::, ::1, ::a.b.c.d
	if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff)
		return blockedV4(v4OfGroups(g6, g7)); // IPv4-mapped
	if (g0 === 0x64 && g1 === 0xff9b) {
		// NAT64: the embedded IPv4 decides; the local-use prefix is private.
		return (
			g2 !== 0 ||
			g3 !== 0 ||
			g4 !== 0 ||
			g5 !== 0 ||
			blockedV4(v4OfGroups(g6, g7))
		);
	}
	if (g0 === 0x2002) return blockedV4(v4OfGroups(g1, g2)); // 6to4
	return (
		(g0 === 0x2001 && g1 === 0) || // Teredo
		(g0 === 0x2001 && g1 === 0xdb8) || // documentation
		(g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) || // discard-only
		(g0 & 0xfe00) === 0xfc00 || // unique local
		(g0 & 0xffc0) === 0xfe80 || // link-local
		(g0 & 0xffc0) === 0xfec0 || // site-local
		(g0 & 0xff00) === 0xff00 // multicast
	);
}

/** True for an address a webhook may not reach by default. Anything that is not an IP is blocked. */
export function isBlockedAddress(ip: string): boolean {
	const v4 = parseV4(ip);
	if (v4) return blockedV4(v4);
	const v6 = parseV6(ip);
	return v6 ? blockedV6(v6) : true;
}

export type TargetOptions = {
	/** The admin setting: private targets and plain http are allowed. */
	allowPrivate: boolean;
	resolve?: Resolver;
};

export type CheckedTarget = { url: URL; addresses: string[] };

const LOCAL_NAME = /(^|\.)(localhost|local|internal|localdomain)$/;

/**
 * Validates a webhook URL and resolves it. Returns the parsed URL and the
 * addresses to connect to, all of which passed. Throws WebhookTargetError.
 */
export async function checkWebhookTarget(
	raw: string,
	{ allowPrivate, resolve = resolveAll }: TargetOptions,
): Promise<CheckedTarget> {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new WebhookTargetError("invalid_url", "That is not a valid URL");
	}
	if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:"))
		throw new WebhookTargetError("https_required", "The URL must use https");
	if (url.username || url.password)
		throw new WebhookTargetError(
			"credentials_not_allowed",
			"The URL cannot hold a user name or password",
		);

	const host = url.hostname.replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "");
	if (!host)
		throw new WebhookTargetError("invalid_url", "That is not a valid URL");
	if (!allowPrivate && LOCAL_NAME.test(host.toLowerCase()))
		throw new WebhookTargetError(
			"blocked_target",
			"That address is on a private network",
		);

	let addresses: string[];
	if (isIP(host) !== 0) addresses = [host];
	else {
		try {
			addresses = await resolve(host);
		} catch {
			throw new WebhookTargetError(
				"unresolvable",
				"That host name does not resolve",
			);
		}
		if (addresses.length === 0)
			throw new WebhookTargetError(
				"unresolvable",
				"That host name does not resolve",
			);
	}
	if (!allowPrivate && addresses.some(isBlockedAddress))
		throw new WebhookTargetError(
			"blocked_target",
			"That address is on a private network",
		);
	return { url, addresses };
}
