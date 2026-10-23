import "server-only";

/**
 * SEAM: the per-user default rate type (N73).
 *
 * segment/money-engine has the real service (`defaultRateType`,
 * `rateOptions`, `setDefaultRateType` in src/server/services/rate-types.ts,
 * stored per home currency in user.defaultRateTypes). It is not on this
 * branch's base, so until it merges:
 * - the default is the built-in one (blue, then official, then the table's
 *   first type), the same order the rate table already picks by;
 * - nothing can change it, so the page shows the default without a picker.
 * When rate-types.ts lands, replace both functions with calls into it and
 * flip CAN_SET_DEFAULT (GAPS: "Currencies: default rate type per currency").
 */
export const CAN_SET_DEFAULT = false;

const BUILT_IN_ORDER = ["blue", "official"];

/** The type new amounts in a currency use, from the types it has. */
export function defaultRateType(types: readonly string[]): string | null {
	for (const type of BUILT_IN_ORDER) if (types.includes(type)) return type;
	return types[0] ?? null;
}
