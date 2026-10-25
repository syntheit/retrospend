import { createORPCClient, ORPCError } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import {
	API_PREFIX,
	type Contract,
	contract,
	IDEMPOTENCY_HEADER,
	isWriteMethod,
	PROBLEM_CONTENT_TYPE,
	type Problem,
} from "@retrospend/api-contract";

/**
 * Per-call options. Writes need an idempotency key; keep the same key when
 * retrying one logical write so the server replays instead of writing twice.
 * A write called without one gets a fresh key, which is right for a user
 * action that is not retried (a button press) and wrong for a queued write:
 * an outbox passes its own stable key.
 */
export type CallContext = { idempotencyKey?: string };

export type RetrospendClient = ContractRouterClient<Contract, CallContext>;

export type ClientOptions = {
	/** Server origin, for example https://retrospend.app. */
	baseUrl: string;
	/** Credentials per request: `{ authorization: "Bearer ..." }` or `{ "x-api-key": ... }`. */
	authHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
	fetch?: typeof globalThis.fetch;
	/**
	 * A fresh Idempotency-Key for a write called without one. Defaults to
	 * `crypto.randomUUID()` where it exists (browsers, Node); React Native
	 * has none, so pass one (expo-crypto) or give every write its own key.
	 */
	newIdempotencyKey?: () => string;
};

/** Whether the route at this router path is a write (POST, PUT, PATCH, DELETE). */
function isWriteRoute(path: readonly string[]): boolean {
	let node: unknown = contract;
	for (const key of path) node = (node as Record<string, unknown>)?.[key];
	const route = (node as { "~orpc"?: { route?: { method?: string } } })?.[
		"~orpc"
	]?.route;
	return isWriteMethod(route?.method ?? "POST");
}

function isProblem(body: unknown): body is Problem {
	return (
		typeof body === "object" &&
		body !== null &&
		typeof (body as Problem).code === "string" &&
		typeof (body as Problem).status === "number"
	);
}

/**
 * oRPC only parses `application/json` bodies, so relabel problem+json
 * (same JSON, RFC 9457 media type) before the link reads it.
 */
function problemAwareFetch(
	base: typeof globalThis.fetch,
): typeof globalThis.fetch {
	return async (input, init) => {
		const response = await base(input, init);
		const type = response.headers.get("content-type") ?? "";
		if (!type.startsWith(PROBLEM_CONTENT_TYPE)) return response;
		const headers = new Headers(response.headers);
		headers.set("content-type", "application/json");
		// React Native's fetch has no `response.body` stream: copying it would
		// send an empty body, and every problem would read as "cannot parse".
		return new Response(await response.text(), {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	};
}

/**
 * A typed /api/v1 client from the contract: no codegen. Errors arrive as
 * ORPCError whose `code` is the stable problem code and whose `data` is
 * the full problem+json body.
 */
export function createRetrospendClient(
	options: ClientOptions,
): RetrospendClient {
	const newKey: () => string | undefined =
		options.newIdempotencyKey ??
		(() => globalThis.crypto?.randomUUID?.() ?? undefined);
	const link = new OpenAPILink<CallContext>(contract, {
		url: `${options.baseUrl.replace(/\/$/, "")}${API_PREFIX}`,
		headers: async ({ context }, path) => {
			const key =
				context.idempotencyKey ??
				(isWriteRoute(path) ? newKey() : undefined);
			return {
				...(await options.authHeaders?.()),
				...(key ? { [IDEMPOTENCY_HEADER]: key } : {}),
			};
		},
		fetch: problemAwareFetch(options.fetch ?? globalThis.fetch),
		customErrorResponseBodyDecoder: (body, response) =>
			isProblem(body)
				? new ORPCError(body.code, {
						status: response.status,
						message: body.detail ?? body.title,
						data: body,
					})
				: null,
	});
	return createORPCClient(link);
}
