/**
 * Ordering by user text in the app layer against the `ORDER BY name` SQL it
 * replaced (E2EE lane D10). The old queries are copied here as the oracle: on
 * a plaintext ledger every list must come back in the same order as
 * Postgres sorted it, page by page for the cursor lists.
 *
 * The names mix what makes locale-aware sorting differ from byte order:
 * upper and lower case, accents, punctuation, digits, a private-use
 * character above the surrogates, and emoji.
 */
import { describe, expect, it } from "vitest";
import {
	listCategoriesByName,
	listCategoriesByUsage,
} from "~/server/services/category.service";
import { entryCatalog } from "~/server/services/entry/catalog";
import { ensureIncomeCategories } from "~/server/services/money-in.service";
import {
	adminDb,
	createTestUser,
	fixtureDb,
	sealedSuite,
} from "~/test/pg-harness";
import { compareText, sortByText } from "../text-order";

const NAMES = [
	"banana",
	"Banana",
	"Zebra",
	"apple",
	"Apple",
	"Ärger",
	"émile",
	"😀 smile",
	" private",
	"�",
	"a b",
	"a_b",
	"a-b",
	"a.b",
	"10",
	"9",
	"apple2",
	"ñandú",
	"Zürich",
	"z",
	"İstanbul",
	"ß",
	"ss",
];

type Id = { id: string };
const ids = (rows: readonly Id[]) => rows.map((r) => r.id);

/** Deterministic pseudo-random numbers, so a failure repeats. */
function prng(seed: number) {
	let s = seed;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

const RANGES: readonly (readonly [number, number])[] = [
	[0x20, 0x7e],
	[0xa0, 0x24f],
	[0x400, 0x4ff],
	[0x3040, 0x30ff],
	[0xe000, 0xfffd],
	[0x10000, 0x1ffff],
];

function randomStrings(count: number): string[] {
	const next = prng(7);
	const out = new Set<string>();
	while (out.size < count) {
		let text = "";
		for (let n = 1 + Math.floor(next() * 4); n > 0; n--) {
			const [lo, hi] = RANGES[Math.floor(next() * RANGES.length)] as [
				number,
				number,
			];
			text += String.fromCodePoint(lo + Math.floor(next() * (hi - lo + 1)));
		}
		out.add(text);
	}
	return [...out];
}

const asSql = (names: string[]) =>
	adminDb.$queryRaw<{ x: string }[]>`
		SELECT x FROM unnest(${names}::text[]) AS t(x) ORDER BY x COLLATE "C"`;

describe("compareText", () => {
	it("orders like Postgres byte order (COLLATE C) over mixed scripts and emoji", async () => {
		const names = [...NAMES, ...randomStrings(400)];
		const sql = (await asSql(names)).map((r) => r.x);
		expect([...names].sort(compareText)).toEqual(sql);
	});

	it("differs from UTF-16 order exactly where emoji meet U+E000 to U+FFFF", () => {
		expect("😀" < "").toBe(true);
		expect(compareText("😀", "")).toBe(1);
	});

	it("is the default collation order of the database the tests run on", async () => {
		// The postgres:16-alpine image sorts by bytes (musl has no locale
		// collation). If this fails, the image changed to a locale-aware one:
		// the app still sorts by code point, so lists now differ from what that
		// database would have returned. Decide that on purpose.
		const rows = await adminDb.$queryRaw<{ x: string }[]>`
			SELECT x FROM unnest(${NAMES}::text[]) AS t(x) ORDER BY x`;
		expect(rows.map((r) => r.x)).toEqual([...NAMES].sort(compareText));
	});

	it("breaks ties by id in sortByText and leaves its input alone", () => {
		const rows = [
			{ id: "b", n: "x" },
			{ id: "a", n: "x" },
			{ id: "c", n: "W" },
		];
		expect(sortByText(rows, (r) => r.n).map((r) => r.id)).toEqual([
			"c",
			"a",
			"b",
		]);
		expect(rows.map((r) => r.id)).toEqual(["b", "a", "c"]);
	});
});

async function seedCategories(userId: string) {
	const made = await Promise.all(
		NAMES.map((name) =>
			fixtureDb.category.create({ data: { name, color: "teal", userId } }),
		),
	);
	const byName = new Map(made.map((c) => [c.name, c.id]));
	// Usage: banana 2, Zebra 2, apple 1, the rest 0.
	const uses: [string, number][] = [
		["banana", 2],
		["Zebra", 2],
		["apple", 1],
	];
	for (const [name, count] of uses)
		for (let i = 0; i < count; i++)
			await fixtureDb.expense.create({
				data: {
					userId,
					title: `${name} ${i}`,
					amount: "100",
					currency: "ARS",
					amountInUSD: "0.1",
					exchangeRate: "1000",
					pricingSource: "MANUAL",
					date: new Date("2026-10-10T12:00:00Z"),
					categoryId: byName.get(name),
				},
			});
}

// The oracle is the old SQL over stored names, which the sealed suite
// (PG_TEST_SEALED) seals: it is compared only where the names are plaintext.
// The orders written out by hand hold in both.
const oracle = !sealedSuite;

describe("category lists", () => {
	it("by name pages like ORDER BY name, id with a keyset cursor", async () => {
		const { user, db } = await createTestUser();
		await seedCategories(user.id);

		const old = (after: { name: string; id: string } | null, take: number) =>
			after
				? adminDb.$queryRaw<Id[]>`
					SELECT id FROM category
					WHERE "userId" = ${user.id} AND (name, id) > (${after.name}, ${after.id})
					ORDER BY name, id LIMIT ${take}`
				: adminDb.$queryRaw<Id[]>`
					SELECT id FROM category WHERE "userId" = ${user.id}
					ORDER BY name, id LIMIT ${take}`;

		let after: { name: string; id: string } | null = null;
		let pages = 0;
		for (;;) {
			const page = await listCategoriesByName(db, user.id, { after, take: 4 });
			if (oracle) expect(ids(page)).toEqual(ids(await old(after, 4)));
			pages++;
			const last = page.at(-1);
			if (page.length < 4 || !last) break;
			after = { name: last.name, id: last.id };
		}
		expect(pages).toBe(
			Math.ceil(NAMES.length / 4) + (NAMES.length % 4 === 0 ? 1 : 0),
		);
	});

	it("by usage lists the most used first, then by name", async () => {
		const { user, db } = await createTestUser();
		await seedCategories(user.id);
		const old = await adminDb.$queryRaw<Id[]>`
			SELECT c.id FROM category c WHERE c."userId" = ${user.id}
			ORDER BY (SELECT count(*) FROM expense e WHERE e."categoryId" = c.id) DESC,
				c.name`;
		const rows = await listCategoriesByUsage(db, user.id);
		if (oracle) expect(ids(rows)).toEqual(ids(old));
		expect(rows.slice(0, 3).map((r) => r.name)).toEqual([
			"Zebra",
			"banana",
			"apple",
		]);
	});

	it("the Add catalog lists categories by usage then name and accounts by type then name", async () => {
		const { user, db } = await createTestUser();
		await seedCategories(user.id);
		const accounts: [string, "CASH" | "INVESTMENT" | "LIABILITY_LOAN"][] = [
			["wallet", "CASH"],
			["Bank", "CASH"],
			["Émile fund", "INVESTMENT"],
			["alpha fund", "INVESTMENT"],
			["😀 loan", "LIABILITY_LOAN"],
			["Car loan", "LIABILITY_LOAN"],
		];
		const made = new Map<string, string>();
		for (const [name, type] of accounts)
			made.set(
				name,
				(
					await fixtureDb.assetAccount.create({
						data: {
							userId: user.id,
							name,
							type,
							currency: "USD",
							balance: "10",
							exchangeRate: 1,
						},
					})
				).id,
			);

		const catalog = await entryCatalog(db, user.id);
		const oldCategories = await adminDb.$queryRaw<Id[]>`
			SELECT c.id FROM category c WHERE c."userId" = ${user.id}
			ORDER BY (SELECT count(*) FROM expense e WHERE e."categoryId" = c.id) DESC,
				c.name`;
		if (oracle) expect(ids(catalog.categories)).toEqual(ids(oldCategories));
		expect(catalog.categories.some((c) => "_count" in c)).toBe(false);

		const oldPlaces = await adminDb.$queryRaw<Id[]>`
			SELECT id FROM asset_account WHERE "userId" = ${user.id} AND "closedAt" IS NULL
			ORDER BY type, name`;
		if (oracle) expect(ids(catalog.places)).toEqual(ids(oldPlaces));
		expect(catalog.places.length).toBe(accounts.length);
		expect(catalog.places.map((p) => p.id)).toEqual(
			["Bank", "wallet", "alpha fund", "Émile fund", "Car loan", "😀 loan"].map(
				(n) => made.get(n),
			),
		);
	});

	it("the income categories come back by name", async () => {
		const { user, db } = await createTestUser();
		const rows = await ensureIncomeCategories(db, user.id);
		const old = await adminDb.$queryRaw<Id[]>`
			SELECT id FROM category WHERE "userId" = ${user.id} AND kind = 'INCOME'
			ORDER BY name`;
		if (oracle) expect(ids(rows)).toEqual(ids(old));
		expect(rows).toHaveLength(6);
	});
});
