// The connect-to-server probe: GET /api/v1/server-info.
//
// STUB CONTRACT: packages/api-contract is not on this segment yet. ServerInfo
// below mirrors serverInfoSchema in @retrospend/api-contract (platform), and
// isServerInfo checks only the fields the app acts on. When the package
// lands, import the type and parse with serverInfoSchema instead.

export interface ServerInfo {
	name: "Retrospend";
	version: string;
	apiVersion: "v1";
	minClientVersion: string;
	features: Record<string, boolean>;
	auth: { methods: string[]; signUp: "open" | "inviteOnly" };
	push: { transports: string[] };
}

export type ProbeResult =
	| { ok: true; baseUrl: string; insecure: boolean; info: ServerInfo }
	| { ok: false; reason: "invalidUrl" | "unreachable" | "notRetrospend" }
	| { ok: false; reason: "appTooOld"; minClientVersion: string };

export const DEFAULT_SERVER = "https://retrospend.app";
const PROBE_TIMEOUT_MS = 10_000;

/**
 * What the connect field starts with. A build can bake in its own server
 * (RETROSPEND_DEFAULT_SERVER, read by app.config.ts into extra); without one
 * the field starts on retrospend.app. The person can always edit it.
 */
export function initialServerAddress(configured: unknown): string {
	const text = typeof configured === "string" ? configured.trim() : "";
	const normalized = text ? normalizeServerUrl(text) : null;
	if (!normalized) return new URL(DEFAULT_SERVER).host;
	// https is the default scheme the field adds, so it is left off.
	return normalized.replace(/^https:\/\//, "");
}

/**
 * The base URL for what the user typed: https when no scheme is given, no
 * query, hash or trailing slash. A path stays, for servers behind a prefix.
 * Returns null when it is not an http(s) address.
 */
export function normalizeServerUrl(input: string): string | null {
	const text = input.trim();
	if (!text) return null;
	const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(text)
		? text
		: `https://${text}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	if (!url.hostname || /\s/.test(url.hostname)) return null;
	const path = url.pathname.replace(/\/+$/, "");
	return `${url.protocol}//${url.host}${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isServerInfo(value: unknown): value is ServerInfo {
	if (!isRecord(value)) return false;
	return (
		value.name === "Retrospend" &&
		value.apiVersion === "v1" &&
		typeof value.version === "string" &&
		typeof value.minClientVersion === "string" &&
		isRecord(value.features) &&
		isRecord(value.auth) &&
		isRecord(value.push)
	);
}

/** Compares dotted numeric versions ("0.10.0" > "0.9.3"); a suffix is ignored. */
export function compareVersions(a: string, b: string): number {
	const parts = (v: string) =>
		(v.split(/[-+]/)[0] ?? "")
			.split(".")
			.map((n) => Number.parseInt(n, 10) || 0);
	const [pa, pb] = [parts(a), parts(b)];
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return Math.sign(diff);
	}
	return 0;
}

type Fetched =
	| { ok: true; body: unknown }
	| { ok: false; reason: "unreachable" | "notRetrospend" };

function parseJson(text: string): Fetched {
	try {
		return { ok: true, body: JSON.parse(text) };
	} catch {
		return { ok: false, reason: "notRetrospend" };
	}
}

/**
 * GET server-info and read its body under one timeout: a server that sends
 * headers and then stalls the body is as unreachable as one that never
 * answers.
 */
async function fetchServerInfo(
	baseUrl: string,
	fetchImpl: typeof fetch,
): Promise<Fetched> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
	try {
		const response = await fetchImpl(`${baseUrl}/api/v1/server-info`, {
			headers: { Accept: "application/json" },
			signal: controller.signal,
		});
		if (!response.ok) return { ok: false, reason: "notRetrospend" };
		return parseJson(await response.text());
	} catch {
		return { ok: false, reason: "unreachable" };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Asks the server what it is, and whether this app version may talk to it.
 * Plain http is allowed (self-hosters own their network) but flagged, so the
 * connect screen warns before saving it.
 */
export async function probeServer(
	input: string,
	appVersion: string,
	fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult> {
	const baseUrl = normalizeServerUrl(input);
	if (!baseUrl) return { ok: false, reason: "invalidUrl" };

	const fetched = await fetchServerInfo(baseUrl, fetchImpl);
	if (!fetched.ok) return fetched;
	const body = fetched.body;
	if (!isServerInfo(body)) return { ok: false, reason: "notRetrospend" };
	if (compareVersions(appVersion, body.minClientVersion) < 0) {
		return {
			ok: false,
			reason: "appTooOld",
			minClientVersion: body.minClientVersion,
		};
	}
	const insecure = baseUrl.startsWith("http:");
	return { ok: true, baseUrl, insecure, info: body };
}
