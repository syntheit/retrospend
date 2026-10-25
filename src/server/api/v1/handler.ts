import { OpenAPIHandler } from "@orpc/openapi/fetch";
import type { Router } from "@orpc/server";
import { ResponseHeadersPlugin } from "@orpc/server/plugins";
import {
	API_PREFIX,
	PROBLEM_CONTENT_TYPE,
} from "@retrospend/api-contract/common";
import { IMPORT_MAX_BYTES } from "@retrospend/api-contract";
import { encodeProblem, problem } from "./errors";
import type { V1InitialContext } from "./middleware";
import { v1Router } from "./router";

/** The biggest file field is the 10 MB import; the rest is form overhead. */
export const MULTIPART_LIMIT = IMPORT_MAX_BYTES + 1024 * 1024;

/**
 * Stops an oversized upload before it is read into memory. A declared
 * Content-Length over the limit is refused at once (413); a body that does
 * not declare one is counted as it streams and cut off at the limit.
 */
function capUpload(request: Request): Request | Response {
	const type = request.headers.get("content-type") ?? "";
	if (!type.toLowerCase().startsWith("multipart/form-data") || !request.body)
		return request;
	const declared = Number(request.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MULTIPART_LIMIT)
		return Response.json(encodeProblem(problem("payload_too_large")), {
			status: 413,
		});
	let seen = 0;
	const counted = request.body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				seen += chunk.byteLength;
				if (seen > MULTIPART_LIMIT)
					controller.error(new Error("Upload too large"));
				else controller.enqueue(chunk);
			},
		}),
	);
	return new Request(request, { body: counted, duplex: "half" } as RequestInit);
}

/** Errors are problem+json (RFC 9457); nothing here may be cached. */
function withProblemHeaders(res: Response): Response {
	const headers = new Headers(res.headers);
	if (res.status >= 400) headers.set("content-type", PROBLEM_CONTENT_TYPE);
	headers.set("cache-control", "no-store");
	return new Response(res.body, { status: res.status, headers });
}

/** Builds a fetch handler for a v1 router (tests pass their own router). */
export function createV1Handler(
	// biome-ignore lint/suspicious/noExplicitAny: oRPC routers are typed per contract
	router: Router<any, V1InitialContext>,
) {
	const handler = new OpenAPIHandler<V1InitialContext>(router, {
		plugins: [new ResponseHeadersPlugin()],
		customErrorResponseBodyEncoder: encodeProblem,
	});

	return async function handle(incoming: Request): Promise<Response> {
		const capped = capUpload(incoming);
		if (capped instanceof Response) return withProblemHeaders(capped);
		const request = capped;
		const { matched, response } = await handler.handle(request, {
			prefix: API_PREFIX,
			context: { headers: request.headers },
		});
		const res = matched
			? response
			: Response.json(encodeProblem(problem("not_found")), { status: 404 });
		return withProblemHeaders(res);
	};
}

export const handleV1Request = createV1Handler(v1Router);
