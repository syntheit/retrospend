/**
 * Conditional GET for v1 routes whose handler sets an `etag` response header:
 * a request whose If-None-Match names that tag gets 304 and no body.
 */

/** Whether an If-None-Match header (a list of tags, or `*`) names `etag`. */
export function ifNoneMatchHits(header: string | null, etag: string): boolean {
	if (header === null) return false;
	const bare = (tag: string) => tag.trim().replace(/^W\//, "");
	return header
		.split(",")
		.some((tag) => bare(tag) === "*" || bare(tag) === bare(etag));
}

/** The 304 for a 200 response whose tag the request already has, else null. */
export function notModifiedFor(
	request: Request,
	response: Response,
): Response | null {
	const etag = response.headers.get("etag");
	if (
		request.method !== "GET" ||
		response.status !== 200 ||
		etag === null ||
		!ifNoneMatchHits(request.headers.get("if-none-match"), etag)
	)
		return null;
	return new Response(null, { status: 304, headers: { etag } });
}
