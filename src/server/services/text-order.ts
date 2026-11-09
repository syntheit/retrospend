/**
 * Ordering by user text, in the app layer. Names and titles can hold
 * ciphertext (docs/roadmap/e2ee-spike.md, lane D), so Postgres cannot sort
 * them; the services read the rows, which come back as plaintext, and sort
 * here.
 *
 * What it reproduces: `ORDER BY name` on the databases this app ships with.
 * The postgres:16-alpine image runs on musl, which has no locale collation,
 * so its default collation (en_US.utf8) compares bytes. For UTF-8 that is
 * code point order: "Zebra" before "apple", "apple" before "Ärger", and no
 * accent or case folding. `compareText` does the same, which also keeps the
 * order the same on any database a self-hoster points the app at. A database
 * on a locale-aware collation (a Debian Postgres image) used to sort "apple"
 * before "Zebra"; the app now gives it the alpine order too.
 *
 * JavaScript's `<` compares UTF-16 units, which puts a character above
 * U+FFFF (an emoji) before one in U+E000 to U+FFFF; code points are compared
 * here so it does not.
 */

/** -1, 0 or 1 by code point, as Postgres's byte order does for UTF-8 text. */
export function compareText(a: string, b: string): number {
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		const x = a.codePointAt(i) as number;
		const y = b.codePointAt(j) as number;
		if (x !== y) return x < y ? -1 : 1;
		i += x > 0xffff ? 2 : 1;
		j += y > 0xffff ? 2 : 1;
	}
	if (i < a.length) return 1;
	if (j < b.length) return -1;
	return 0;
}

/**
 * The rows by `text` (code points), then by `id`, so rows with equal text
 * keep one order. Does not change `rows`.
 */
export function sortByText<T extends { id: string }>(
	rows: readonly T[],
	text: (row: T) => string,
): T[] {
	return [...rows].sort(
		(a, b) => compareText(text(a), text(b)) || compareText(a.id, b.id),
	);
}

/** Categories most used first, then by name (and id), as the pickers list them. */
export function byUsageThenName<
	T extends { id: string; name: string; _count: { expenses: number } },
>(rows: readonly T[]): T[] {
	return [...rows].sort(
		(a, b) =>
			b._count.expenses - a._count.expenses ||
			compareText(a.name, b.name) ||
			compareText(a.id, b.id),
	);
}
