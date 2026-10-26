import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import { ATTEMPT_TIMEOUT_MS } from "./schedule";
import { checkWebhookTarget, type Resolver, WebhookTargetError } from "./ssrf";

/** A short code for why an attempt failed. Never a response body or an error message. */
export type SendError =
	| "blocked_target"
	| "dns_failed"
	| "timeout"
	| "connection_refused"
	| "tls_error"
	| "connection_error"
	| "http_error"
	| "secret_unreadable"
	| "internal_error";

export type SendResult =
	| { ok: true; statusCode: number }
	| { ok: false; error: SendError; statusCode: number | null };

export type SendInput = {
	url: string;
	body: string | Buffer;
	headers: Record<string, string>;
	allowPrivate: boolean;
	resolve?: Resolver;
	timeoutMs?: number;
};

/** A lookup that answers only with addresses that already passed the check. */
function pinnedLookup(addresses: string[]): LookupFunction {
	return (_hostname, options, callback) => {
		const entries = addresses.map((address) => ({
			address,
			family: isIP(address),
		}));
		if (options.all) {
			// Node types the callback by `all`; the runtime takes the array form.
			(callback as unknown as (e: null, a: typeof entries) => void)(
				null,
				entries,
			);
			return;
		}
		const first = entries[0];
		if (first) callback(null, first.address, first.family);
	};
}

function codeOf(error: unknown): string {
	return String((error as { code?: unknown }).code ?? "");
}

function classify(error: unknown): SendError {
	const code = codeOf(error);
	if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns_failed";
	if (code === "ECONNREFUSED") return "connection_refused";
	if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "timeout";
	if (
		code.startsWith("ERR_TLS") ||
		code.startsWith("CERT_") ||
		code.includes("SELF_SIGNED") ||
		code.includes("UNABLE_TO_VERIFY") ||
		code === "ERR_SSL_WRONG_VERSION_NUMBER"
	)
		return "tls_error";
	return "connection_error";
}

/**
 * One signed POST. The target is checked here, after DNS, on every call,
 * and the connection goes only to the addresses that passed. Redirects are
 * not followed (a 3xx is a failure), the answer body is discarded and the
 * attempt has a hard time limit.
 */
export async function sendWebhook(input: SendInput): Promise<SendResult> {
	const { allowPrivate, resolve } = input;
	let target: Awaited<ReturnType<typeof checkWebhookTarget>>;
	try {
		target = await checkWebhookTarget(input.url, { allowPrivate, resolve });
	} catch (error) {
		if (!(error instanceof WebhookTargetError)) throw error;
		return {
			ok: false,
			error: error.code === "unresolvable" ? "dns_failed" : "blocked_target",
			statusCode: null,
		};
	}

	const { url, addresses } = target;
	const timeoutMs = input.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
	const send = url.protocol === "https:" ? httpsRequest : httpRequest;

	return new Promise<SendResult>((resolveResult) => {
		let done = false;
		const finish = (result: SendResult) => {
			if (done) return;
			done = true;
			clearTimeout(deadline);
			resolveResult(result);
		};
		const req = send(
			url,
			{
				method: "POST",
				headers: {
					...input.headers,
					"Content-Length": String(Buffer.byteLength(input.body)),
				},
				lookup: pinnedLookup(addresses),
				agent: false,
			},
			(res) => {
				// The answer is never read: stop a receiver that streams forever.
				res.destroy();
				const statusCode = res.statusCode ?? 0;
				finish(
					statusCode >= 200 && statusCode < 300
						? { ok: true, statusCode }
						: { ok: false, error: "http_error", statusCode },
				);
			},
		);
		const deadline = setTimeout(() => {
			req.destroy();
			finish({ ok: false, error: "timeout", statusCode: null });
		}, timeoutMs);
		req.on("error", (error) =>
			finish({ ok: false, error: classify(error), statusCode: null }),
		);
		req.end(input.body);
	});
}
