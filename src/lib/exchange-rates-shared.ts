/**
 * Converts a rate type key to a human-readable label.
 * @param type - The rate type (e.g., "official", "blue", "mep")
 * @returns A formatted display label
 */
export function getRateTypeLabel(type: string): string {
	const labels: Record<string, string> = {
		official: "Official",
		blue: "Blue (Informal)",
		mep: "MEP",
		crypto: "Crypto",
		tourist: "Tourist",
	};
	return labels[type] || type.charAt(0).toUpperCase() + type.slice(1);
}
