/**
 * Utility to mask financial numbers for privacy.
 * Always returns a fixed string of dots to prevent guessing magnitudes.
 */
export function maskAmount(_amount: number | string): string {
	return "••••••";
}
