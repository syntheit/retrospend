/**
 * An event type as a short label: FAILED_LOGIN is "Failed login". The log is
 * the server's own record, so the labels follow the type names, as on the web.
 */
export function eventLabel(type: string): string {
	const words = type.toLowerCase().split("_").join(" ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A metadata key as a label: adminUsername is "Admin username". */
export function keyLabel(key: string): string {
	const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

type Scalar = string | number | boolean | null;

/** An event's metadata as label and value rows; lists are joined, null is left out. */
export function metadataFacts(
	metadata: Record<string, unknown> | null,
): { label: string; value: string }[] {
	if (!metadata) return [];
	const rows: { label: string; value: string }[] = [];
	for (const [key, raw] of Object.entries(metadata)) {
		const value = raw as Scalar | Scalar[];
		if (value === null) continue;
		rows.push({
			label: keyLabel(key),
			value: Array.isArray(value)
				? value.filter((v) => v !== null).join(", ")
				: String(value),
		});
	}
	return rows.filter((row) => row.value !== "");
}
