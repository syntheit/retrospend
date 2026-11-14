/**
 * The checks the sync apply layer makes on the text and numbers of a wire
 * row before it writes anything. A value that fails throws InvalidInputError,
 * which refuses the whole page.
 */
import { InvalidInputError } from "./port";

/** The decimal text the server sends: optional minus, digits, optional fraction. */
const DECIMAL = /^-?\d+(\.\d+)?$/;

export const decimal = (value: string, what: string): string => {
	if (!DECIMAL.test(value))
		throw new InvalidInputError(`${what} is not a decimal`);
	return value;
};

export const decimalOrNull = (value: string | null, what: string) =>
	value === null ? null : decimal(value, what);

export function instant(value: string, what: string): Date {
	const date = new Date(value);
	if (Number.isNaN(date.getTime()))
		throw new InvalidInputError(`${what} is not a date`);
	return date;
}

export const instantOrNull = (value: string | null, what: string) =>
	value === null ? null : instant(value, what);

/** A YYYYMM month key: a whole number with a month from 1 to 12. */
export function monthKey(value: number, what: string): number {
	const month = value % 100;
	if (
		!Number.isInteger(value) ||
		value < 100_000 ||
		value > 999_912 ||
		month < 1 ||
		month > 12
	)
		throw new InvalidInputError(`${what} is not a month`);
	return value;
}

export const monthKeyOrNull = (value: number | null, what: string) =>
	value === null ? null : monthKey(value, what);
