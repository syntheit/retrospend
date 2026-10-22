import type { MoneyInputResult } from "@retrospend/domain/parse";

/**
 * A balance as typed. Unlike an expense, zero is a real balance (an
 * emptied account), so the parser's "zero" answer is accepted here; the
 * kit's MoneyInput has no zero-allowed mode yet (reported). Empty is zero
 * only when the caller says so (a new account).
 */
export function balanceMinor(
	result: MoneyInputResult,
	emptyIsZero = false,
): number | null {
	if (result.ok) return result.minor;
	if (result.error === "zero") return 0;
	if (emptyIsZero && result.error === "empty") return 0;
	return null;
}
