/** The JSON paths of every string that starts with U+0001 inside `value`. */
export function sealedPaths(value: unknown, path = "$"): string[] {
	if (typeof value === "string")
		return value.startsWith("\u0001") ? [path] : [];
	if (Array.isArray(value))
		return value.flatMap((item, i) => sealedPaths(item, `${path}[${i}]`));
	if (typeof value === "object" && value !== null)
		return Object.entries(value).flatMap(([key, item]) =>
			sealedPaths(item, `${path}.${key}`),
		);
	return [];
}

/**
 * `sealedPaths` for a response body. A JSON body is one value. The app's
 * tRPC client batches with httpBatchStreamLink, whose answer is JSON lines
 * under a JSON content type (one value per line), so a body that is not one
 * value is read line by line, with the line number in the path. A body that
 * is neither throws, so a format nobody checks can never pass as clean.
 */
export function sealedPathsInBody(text: string): string[] {
	const body = text.trim();
	if (body === "") return [];
	try {
		return sealedPaths(JSON.parse(body));
	} catch {
		return body
			.split("\n")
			.flatMap((line, i) =>
				line.trim() === "" ? [] : sealedPaths(JSON.parse(line), `#${i + 1}$`),
			);
	}
}
