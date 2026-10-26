import openapi from "@retrospend/api-contract/openapi.json";

export const dynamic = "force-static";

/** The OpenAPI document as committed; the reference pages render the same file. */
export function GET() {
	return Response.json(openapi, {
		headers: { "cache-control": "public, max-age=300" },
	});
}
