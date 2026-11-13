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
