import { handleV1Request } from "~/server/api/v1/handler";

/**
 * The single /api/v1 entry point. Routing, auth, scopes, rate limits and
 * idempotency all happen in src/server/api/v1 against the oRPC contract in
 * packages/api-contract; OpenAPI is packages/api-contract/openapi.json.
 */
const handle = (request: Request) => handleV1Request(request);

export {
	handle as DELETE,
	handle as GET,
	handle as PATCH,
	handle as POST,
	handle as PUT,
};
