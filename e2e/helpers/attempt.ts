import { test } from "@playwright/test";

/**
 * A title unique to this attempt of the running test. A retry, or another
 * run of `--repeat-each`, works against the rows earlier attempts left
 * behind (the database is seeded once per run), so each attempt names what
 * it creates differently. The first attempt keeps the plain "(attempt 1)".
 */
export function attemptTitle(base: string): string {
	const { retry, repeatEachIndex } = test.info();
	const repeat = repeatEachIndex > 0 ? `, run ${repeatEachIndex + 1}` : "";
	return `${base} (attempt ${retry + 1}${repeat})`;
}
