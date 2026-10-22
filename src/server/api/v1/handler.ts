import { OpenAPIHandler } from "@orpc/openapi/fetch";
import type { Router } from "@orpc/server";
import { ResponseHeadersPlugin } from "@orpc/server/plugins";
import {
	API_PREFIX,
	PROBLEM_CONTENT_TYPE,
} from "@retrospend/api-contract/common";
import { encodeProblem, problem } from "./errors";
import type { V1InitialContext } from "./middleware";
import { v1Router } from "./router";

/** Builds a fetch handler for a v1 router (tests pass their own router). */
export function createV1Handler(
	// biome-ignore lint/suspicious/noExplicitAny: oRPC routers are typed per contract
	router: Router<any, V1InitialContext>,
) {
	const handler = new OpenAPIHandler<V1InitialContext>(router, {
		plugins: [new ResponseHeadersPlugin()],
		customErrorResponseBodyEncoder: encodeProblem,
	});

	return async function handle(request: Request): Promise<Response> {
		const { matched, response } = await handler.handle(request, {
			prefix: API_PREFIX,
			context: { headers: request.headers },
		});
		const res = matched
			? response
			: Response.json(encodeProblem(problem("not_found")), { status: 404 });
		// Errors are problem+json (RFC 9457); nothing here may be cached.
		const headers = new Headers(res.headers);
		if (res.status >= 400) headers.set("content-type", PROBLEM_CONTENT_TYPE);
		headers.set("cache-control", "no-store");
		return new Response(res.body, { status: res.status, headers });
	};
}

export const handleV1Request = createV1Handler(v1Router);
