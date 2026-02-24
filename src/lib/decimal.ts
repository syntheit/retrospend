/**
 * Represents the shape of a Prisma Decimal object.
 */
export interface PrismaDecimal {
	toNumber: () => number;
	toString: () => string;
}

/**
 * Type guard to check if a value is a Prisma Decimal object.
 */
export function isPrismaDecimal(value: unknown): value is PrismaDecimal {
	return (
		typeof value === "object" &&
		value !== null &&
		"toNumber" in value &&
		typeof (value as PrismaDecimal).toNumber === "function" &&
		"toString" in value &&
		typeof (value as PrismaDecimal).toString === "function"
	);
}

/**
 * Safely converts a value to a number, handling Prisma Decimal objects.
 * Returns undefined if the value is null/undefined or not convertible.
 */
export function toNumber(value: unknown): number | undefined {
	if (value === null || value === undefined) {
		return undefined;
	}

	if (typeof value === "number") {
		return value;
	}

	if (isPrismaDecimal(value)) {
		return value.toNumber();
	}

	const parsed = Number(value);
	return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Safely converts a value to a number with a default of 0.
 * Useful for required number fields that should never be null/undefined.
 */
export function toNumberWithDefault(value: unknown): number {
	return toNumber(value) ?? 0;
}

/**
 * Safely converts a value to a number, returning null for null/undefined.
 * Useful for optional number fields that should preserve null values.
 */
export function toNumberOrNull(value: unknown): number | null {
	const result = toNumber(value);
	return result === undefined ? null : result;
}
