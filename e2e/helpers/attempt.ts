import { test } from "@playwright/test";

/**
 * A title unique to this attempt of the running test. A retry runs against
 * the rows the failed attempt left behind (the database is seeded once per
 * run), so each attempt names what it creates differently.
 */
export function attemptTitle(base: string): string {
	return `${base} (attempt ${test.info().retry + 1})`;
}
