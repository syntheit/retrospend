import { createORPCClient, ORPCError } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import {
	API_PREFIX,
	type Contract,
	contract,
	IDEMPOTENCY_HEADER,
	PROBLEM_CONTENT_TYPE,
	type Problem,
} from "@retrospend/api-contract";

/**
 * Per-call options. Writes need an idempotency key; keep the same key when
 * retrying one logical write so the server replays instead of writing twice.
 */
export type CallContext = { idempotencyKey?: string };

export type RetrospendClient = ContractRouterClient<Contract, CallContext>;

export type ClientOptions = {
	/** Server origin, for example https://retrospend.app. */
	baseUrl: string;
	/** Credentials per request: `{ authorization: "Bearer ..." }` or `{ "x-api-key": ... }`. */
	authHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
	fetch?: typeof globalThis.fetch;
};

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
		return new Response(response.body, {
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
	const link = new OpenAPILink<CallContext>(contract, {
		url: `${options.baseUrl.replace(/\/$/, "")}${API_PREFIX}`,
		headers: async ({ context }) => ({
			...(await options.authHeaders?.()),
			...(context.idempotencyKey
				? { [IDEMPOTENCY_HEADER]: context.idempotencyKey }
				: {}),
		}),
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
