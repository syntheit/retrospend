/**
 * The wire form of an engine value: dates as ISO text, readonly dropped.
 * The budget services return Date objects and readonly arrays; the v1
 * contract promises plain JSON, so every answer passes through here.
 */
export type Wire<T> = T extends Date
	? string
	: T extends readonly (infer U)[]
		? Wire<U>[]
		: T extends object
			? { -readonly [K in keyof T]: Wire<T[K]> }
			: T;

export const wire = <T>(value: T): Wire<T> =>
	JSON.parse(JSON.stringify(value)) as Wire<T>;
