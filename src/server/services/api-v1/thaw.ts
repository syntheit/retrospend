/**
 * The read services declare their DTOs `readonly`; a zod output schema's
 * arrays are mutable. `thaw` is the type-level bridge: nothing is copied,
 * because a DTO is built fresh per request and is never written to again.
 */
export type Mutable<T> = T extends readonly (infer U)[]
	? Mutable<U>[]
	: T extends object
		? { -readonly [K in keyof T]: Mutable<T[K]> }
		: T;

export const thaw = <T>(value: T) => value as Mutable<T>;
