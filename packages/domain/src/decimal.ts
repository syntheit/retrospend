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
