/**
 * Title suggestions on the SQL path (no keyring) and the app-layer path
 * (keyring), over one mixed ledger. On plaintext the two must return the same
 * suggestions in the same order, and the SQL path must still return what the
 * old code returned (copied below as the oracle) wherever the old order did
 * not depend on a database tie. Then rows that hold ciphertext, the row
 * window, and the failures.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
	FieldCryptoError,
	Keyring,
	sealField,
} from "~/server/crypto/field-crypto";
import { listedEntryWhere } from "~/server/services/spending";
import {
	TITLE_SUGGESTION_WINDOW,
	titleSuggestions,
} from "~/server/services/title-suggestions.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import type { PrismaClient } from "~prisma";

const keyring = new Keyring([{ id: 1, key: Buffer.alloc(32, 9) }]);
const PATHS = [
	["the SQL path (no keyring)", undefined],
	["the app-layer path (keyring)", keyring],
] as const;

const d = (day: number) => new Date(Date.UTC(2026, 9, day, 12));
type Who = Awaited<ReturnType<typeof createTestUser>>;

const base = (userId: string) => ({
	userId,
	currency: "ARS",
	amountInUSD: "1",
	exchangeRate: "1000",
	pricingSource: "MANUAL",
});

type Row = {
	title: string;
	date: number;
	amount?: string;
	categoryId?: string;
	id?: string;
	extra?: Record<string, unknown>;
};

async function seed(user: Who, rows: Row[]) {
	await adminDb.expense.createMany({
		data: rows.map((r) => ({
			...base(user.user.id),
			title: r.title,
			date: d(r.date),
			amount: r.amount ?? "100",
			categoryId: r.categoryId,
			...(r.id ? { id: r.id } : {}),
			...r.extra,
		})),
	});
}

const times = (n: number, make: (i: number) => Row): Row[] =>
	Array.from({ length: n }, (_, i) => make(i));

async function category(user: Who, name: string) {
	return (
		await adminDb.category.create({
			data: { name, color: "emerald", userId: user.user.id },
		})
	).id;
}

async function shared(description: string, participants: string[]) {
	await adminDb.sharedTransaction.create({
		data: {
			description,
			amount: "300",
			currency: "ARS",
			exchangeRate: "1000",
			date: d(1),
			paidByType: "user",
			paidById: participants[0] ?? "",
			createdByType: "user",
			createdById: participants[0] ?? "",
			splitParticipants: {
				create: participants.map((id) => ({
					participantType: "user" as const,
					participantId: id,
					shareAmount: "100",
					verificationStatus: "ACCEPTED" as const,
				})),
			},
		},
	});
}

/** The code before D6, verbatim, as the oracle. */
async function oldTitleSuggestions(
	db: PrismaClient,
	userId: string,
	query: string,
) {
	const [expenseGroups, sharedGroups] = await Promise.all([
		db.expense.groupBy({
			by: ["title"],
			where: {
				...listedEntryWhere(userId),
				title: { contains: query, mode: "insensitive" },
			},
			_count: { title: true },
			orderBy: { _count: { title: "desc" } },
			take: 15,
		}),
		db.sharedTransaction.groupBy({
			by: ["description"],
			where: {
				description: { contains: query, mode: "insensitive" },
				splitParticipants: {
					some: { participantType: "user", participantId: userId },
				},
			},
			_count: { description: true },
			orderBy: { _count: { description: "desc" } },
			take: 15,
		}),
	]);
	const countMap = new Map<string, number>();
	const canonicalTitle = new Map<string, string>();
	for (const g of expenseGroups) {
		const key = g.title.toLowerCase();
		if (!canonicalTitle.has(key)) canonicalTitle.set(key, g.title);
		countMap.set(key, (countMap.get(key) ?? 0) + g._count.title);
	}
	for (const g of sharedGroups) {
		const key = g.description.toLowerCase();
		if (!canonicalTitle.has(key)) canonicalTitle.set(key, g.description);
		countMap.set(key, (countMap.get(key) ?? 0) + g._count.description);
	}
	const sorted = [...countMap.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 8);
	if (sorted.length === 0) return [];
	const topTitles = sorted.map(([key]) => canonicalTitle.get(key) ?? key);
	const recent = await db.expense.findMany({
		where: { ...listedEntryWhere(userId), title: { in: topTitles } },
		orderBy: { date: "desc" },
		select: { title: true, categoryId: true, amount: true, currency: true },
		distinct: ["title"],
	});
	const categoryByTitle = new Map<string, string | null>();
	const amountByTitle = new Map<string, { amount: number; currency: string }>();
	for (const e of recent) {
		const key = e.title.toLowerCase();
		if (!categoryByTitle.has(key)) categoryByTitle.set(key, e.categoryId);
		if (!amountByTitle.has(key))
			amountByTitle.set(key, {
				amount: Number(e.amount),
				currency: e.currency,
			});
	}
	return sorted.map(([lowKey, count]) => ({
		title: canonicalTitle.get(lowKey) ?? lowKey,
		count,
		lastCategoryId: categoryByTitle.get(lowKey) ?? null,
		lastAmount: amountByTitle.get(lowKey)?.amount ?? null,
		lastCurrency: amountByTitle.get(lowKey)?.currency ?? null,
	}));
}

let me: Who;
let other: Who;
let food: string;
let cafe: string;
let rest: string;

beforeAll(async () => {
	me = await createTestUser();
	other = await createTestUser();
	[food, cafe, rest] = await Promise.all([
		category(me, "Food"),
		category(me, "Cafe"),
		category(me, "Rest"),
	]);
	await seed(me, [
		// One title in three casings. "Café con leche" is the most used, so it is
		// the canonical text; the newer lower-case rows must not decide the last
		// use, because the last use is looked up by the canonical text.
		{ title: "Café con leche", date: 1, amount: "1000", categoryId: food },
		{ title: "Café con leche", date: 2, amount: "1200", categoryId: food },
		{ title: "Café con leche", date: 5, amount: "1500", categoryId: cafe },
		{ title: "café con leche", date: 20, amount: "9999", categoryId: rest },
		{ title: "café con leche", date: 21, amount: "9998", categoryId: rest },
		{ title: "CAFÉ CON LECHE", date: 22, amount: "9997", categoryId: rest },
		// Accents are not folded; whitespace is part of the title.
		{ title: "Cafe", date: 3 },
		{ title: "Cafe", date: 4 },
		{ title: " Cafe ", date: 6 },
		{ title: "Cafetería", date: 7 },
		{ title: "Ñandú", date: 8 },
		{ title: "Ñandú", date: 9 },
		{ title: "ñandú", date: 10 },
		{ title: "ÑANDÚ", date: 11 },
		{ title: "İstanbul", date: 12 },
		{ title: "ΟΔΟΣ", date: 13 },
		{ title: "Straße", date: 14 },
		{ title: "100% jugo", date: 15 },
		{ title: "100% jugo", date: 16 },
		{ title: "1000 jugo", date: 17 },
		{ title: "under_score", date: 18 },
		{ title: "underXscore", date: 19 },
		{ title: "xy z", date: 30 },
		{ title: "Tax e%", date: 31 },
		// Equal counts, and two rows of one title on one day (the id decides).
		{ title: "Tie B", date: 23 },
		{ title: "Tie B", date: 24 },
		{ title: "Tie A", date: 25, amount: "111", id: "tieida1" },
		{ title: "Tie A", date: 25, amount: "222", id: "tieida2" },
		{ title: "Tie C", date: 26, extra: { status: "DRAFT" } },
		// Rows a listing never shows: money in, not spending.
		{
			title: "Tie A",
			date: 27,
			amount: "999",
			extra: { direction: "IN", inType: "INCOME" },
		},
		{ title: "Tie B", date: 28, extra: { entryKind: "NOT_SPENDING" } },
	]);
	await seed(other, [
		{ title: "Tie A", date: 29 },
		{ title: "Café de Bob", date: 29 },
	]);
	await shared("Café con leche", [me.user.id, other.user.id]);
	await shared("Tie D", [me.user.id]);
	await shared("Tie D", [me.user.id]);
	await shared("Cafe de otro", [other.user.id]);
});

describe.each(PATHS)("title suggestions on %s", (_name, ring) => {
	const ask = (who: Who, q: string, extra: object = {}) =>
		titleSuggestions(who.db as PrismaClient, who.user.id, q, {
			keyring: ring,
			...extra,
		});
	const summary = async (who: Who, q: string, extra: object = {}) =>
		(await ask(who, q, extra)).map((s) => [s.title, s.count]);

	it("merges casings under the most used text and keeps its last use", async () => {
		// 3 + 2 + 1 personal rows and one shared row, canonical "Café con leche".
		// Last use: the newest row whose title is exactly that text (day 5).
		expect(await ask(me, "café con leche")).toEqual([
			{
				title: "Café con leche",
				count: 7,
				lastCategoryId: cafe,
				lastAmount: 1500,
				lastCurrency: "ARS",
			},
		]);
	});

	it("matches case-insensitively but not across accents", async () => {
		expect(await summary(me, "CAFE")).toEqual([
			["Cafe", 2],
			[" Cafe ", 1],
			["Cafetería", 1],
		]);
		expect(await summary(me, "caf")).toEqual([
			["Café con leche", 7],
			["Cafe", 2],
			[" Cafe ", 1],
			["Cafetería", 1],
		]);
		expect(await summary(me, "ÑANDÚ")).toEqual([["Ñandú", 4]]);
		expect(await summary(me, "nandu")).toEqual([]);
	});

	it("lowercases per code point like ILIKE", async () => {
		expect(await summary(me, "istanbul")).toEqual([["İstanbul", 1]]);
		expect(await summary(me, "οδοσ")).toEqual([["ΟΔΟΣ", 1]]);
		expect(await summary(me, "STRAßE")).toEqual([["Straße", 1]]);
		expect(await summary(me, "STRASSE")).toEqual([]);
	});

	it("treats whitespace as part of the query", async () => {
		expect(await summary(me, " cafe ")).toEqual([[" Cafe ", 1]]);
		expect(await summary(me, "é c")).toEqual([["Café con leche", 7]]);
	});

	it("reads percent, underscore and backslash in the query as ILIKE does", async () => {
		// Prisma's contains does not escape them: `100%` is `%100%%`, so "1000 jugo"
		// matches too; `_` is any one character; a backslash escapes the next one.
		expect(await summary(me, "100%")).toEqual([
			["100% jugo", 2],
			["1000 jugo", 1],
		]);
		expect(await summary(me, "under_score")).toEqual([
			["under_score", 1],
			["underXscore", 1],
		]);
		expect(await summary(me, "x\\y")).toEqual([["xy z", 1]]);
		expect(await summary(me, "e\\")).toEqual([["Tax e%", 1]]);
		// A trailing backslash escapes the closing %, so the title must end in one.
		expect(await summary(me, "\\")).toEqual([["Tax e%", 1]]);
		expect(await summary(me, "c__e")).toEqual([
			["Cafe", 2],
			[" Cafe ", 1],
			["Cafetería", 1],
			["under_score", 1],
			["underXscore", 1],
		]);
	});

	it("orders equal counts by text and decides a same-day last use by id", async () => {
		const tied = await ask(me, "tie");
		expect(tied.map((s) => [s.title, s.count])).toEqual([
			["Tie A", 2],
			["Tie B", 2],
			["Tie D", 2],
			["Tie C", 1],
		]);
		// Money in and not-spending rows, other people's rows, and shared
		// transactions the user is not in, do not count.
		expect(tied.map((s) => s.lastAmount)).toEqual([222, 100, null, 100]);
	});

	it.each(["café con leche", "ñandú", "istanbul", "100%", "straße", "zzz"])(
		"returns what the old code returned for %j",
		async (q) => {
			expect(await ask(me, q)).toEqual(
				await oldTitleSuggestions(me.db as PrismaClient, me.user.id, q),
			);
		},
	);

	it("cuts to 15 titles per source before merging casings, then to 8", async () => {
		const many = await createTestUser();
		await seed(many, [
			// 13 titles of 5 rows, and one title in three casings of 4, 3 and 2:
			// 16 groups, so the smallest casing is cut before the merge.
			...Array.from({ length: 13 }, (_, i) =>
				times(5, (n) => ({
					title: `Fill ${String(i + 1).padStart(2, "0")}`,
					date: 1 + n,
				})),
			).flat(),
			...times(4, (n) => ({ title: "Split", date: 10 + n })),
			...times(3, (n) => ({ title: "split", date: 14 + n })),
			...times(2, (n) => ({ title: "SPLIT", date: 17 + n })),
		]);
		expect(await summary(many, "i")).toEqual([
			["Split", 7],
			...Array.from({ length: 7 }, (_, i) => [
				`Fill ${String(i + 1).padStart(2, "0")}`,
				5,
			]),
		]);
	});

	it("with shared titles only, counts them", async () => {
		const solo = await createTestUser();
		await shared("Pizza night", [solo.user.id]);
		await shared("pizza NIGHT", [solo.user.id]);
		expect(await ask(solo, "pizza")).toEqual([
			{
				title: "Pizza night",
				count: 2,
				lastCategoryId: null,
				lastAmount: null,
				lastCurrency: null,
			},
		]);
	});
});

describe("both paths agree on plaintext", () => {
	// Not "_" or "%": they match every title, and with more than 15 titles of
	// equal count Postgres picks which 15 groups to keep, which the app cannot
	// reproduce (it keeps the first by text).
	const QUERIES = [
		"café con leche",
		"CAFE",
		"caf",
		"ÑANDÚ",
		"nandu",
		"istanbul",
		"οδοσ",
		"STRAßE",
		"100%",
		"under_score",
		"x\\y",
		"e\\",
		"\\",
		"c__e",
		" cafe ",
		"tie",
		"T",
		"e",
		"zzz",
	];
	it.each(QUERIES)("for %j", async (q) => {
		const run = (ring: Keyring | undefined) =>
			titleSuggestions(me.db as PrismaClient, me.user.id, q, { keyring: ring });
		expect(await run(keyring)).toEqual(await run(undefined));
	});
});

describe("the row window", () => {
	let capped: Who;
	beforeAll(async () => {
		capped = await createTestUser();
		await seed(capped, [
			...times(3, (i) => ({ title: "Cap new", date: 1 + i, amount: "10" })),
			...times(4, (i) => ({ title: "Cap old", date: 4 + i, amount: "20" })),
			{ title: "Cap mid", date: 8, amount: "30" },
			{ title: "Cap mid", date: 9, amount: "31" },
			...times(3, (i) => ({ title: "Cap new", date: 10 + i, amount: "40" })),
			{
				title: "Cap new",
				date: 20,
				extra: { direction: "IN", inType: "INCOME" },
			},
		]);
	});
	const ask = (extra: object) =>
		titleSuggestions(capped.db as PrismaClient, capped.user.id, "cap", extra);

	it("is 20,000 rows by default", () => {
		expect(TITLE_SUGGESTION_WINDOW).toBe(20_000);
	});

	it("reads only the newest listed rows on the app path", async () => {
		// The newest five listed rows are days 12, 11, 10 ("Cap new") and 9, 8
		// ("Cap mid"); the money-in row on day 20 does not use a slot.
		const got = await ask({ keyring, window: 5 });
		expect(got.map((s) => [s.title, s.count, s.lastAmount])).toEqual([
			["Cap new", 3, 40],
			["Cap mid", 2, 31],
		]);
	});

	it("matches the SQL path once the window holds every row", async () => {
		const all = await ask({ keyring, window: 12 });
		expect(all.map((s) => [s.title, s.count, s.lastAmount])).toEqual([
			["Cap new", 6, 40],
			["Cap old", 4, 20],
			["Cap mid", 2, 31],
		]);
		expect(all).toEqual(await ask({}));
	});

	it("does not limit the SQL path", async () => {
		expect((await ask({ window: 5 })).map((s) => [s.title, s.count])).toEqual([
			["Cap new", 6],
			["Cap old", 4],
			["Cap mid", 2],
		]);
	});
});

describe("rows that hold ciphertext", () => {
	let mixed: Who;
	let a: string;
	let b: string;
	let c: string;
	const seal = (text: string, rowId: string, ring = keyring) =>
		sealField(ring, text, { table: "expense", column: "title", rowId });

	beforeAll(async () => {
		mixed = await createTestUser();
		[a, b, c] = await Promise.all([
			category(mixed, "A"),
			category(mixed, "B"),
			category(mixed, "C"),
		]);
		await seed(mixed, [
			{ title: "Café con leche", date: 1, amount: "100", categoryId: a },
			{
				id: "mixsealed1",
				title: seal("Café con leche", "mixsealed1"),
				date: 2,
				amount: "200",
				categoryId: b,
			},
			{
				id: "mixsealed2",
				title: seal("CAFÉ CON LECHE", "mixsealed2"),
				date: 3,
				amount: "300",
				categoryId: c,
			},
			{ id: "mixsealed3", title: seal("Ñandú", "mixsealed3"), date: 4 },
			{ title: "Pan", date: 5 },
		]);
	});
	const ask = (q: string, ring?: Keyring) =>
		titleSuggestions(mixed.db as PrismaClient, mixed.user.id, q, {
			keyring: ring,
		});

	it("counts sealed and plaintext rows of one title together", async () => {
		expect(await ask("café", keyring)).toEqual([
			{
				title: "Café con leche",
				count: 3,
				lastCategoryId: b,
				lastAmount: 200,
				lastCurrency: "ARS",
			},
		]);
		expect(await ask("ÑANDÚ", keyring)).toEqual([
			{
				title: "Ñandú",
				count: 1,
				lastCategoryId: null,
				lastAmount: 100,
				lastCurrency: "ARS",
			},
		]);
	});

	it("is what the SQL path cannot see", async () => {
		expect(
			(await ask("café")).map((s) => [s.title, s.count, s.lastAmount]),
		).toEqual([["Café con leche", 1, 100]]);
		expect(await ask("ÑANDÚ")).toEqual([]);
	});

	it("fails on a key it does not hold, never as a non-match", async () => {
		const stranger = new Keyring([{ id: 2, key: Buffer.alloc(32, 5) }]);
		await expect(ask("pan", stranger)).rejects.toMatchObject({
			code: "unknown_key",
		});
	});

	it("fails on a title sealed for another row", async () => {
		const bad = await createTestUser();
		await seed(bad, [
			{ id: "badrow1", title: seal("Pan", "someotherrow"), date: 1 },
		]);
		const run = titleSuggestions(bad.db as PrismaClient, bad.user.id, "pan", {
			keyring,
		});
		await expect(run).rejects.toBeInstanceOf(FieldCryptoError);
		await expect(run).rejects.toMatchObject({ code: "auth_failed" });
	});
});

describe("shared descriptions on the app path", () => {
	const sealShared = (text: string, rowId: string) =>
		sealField(keyring, text, {
			table: "shared_transaction",
			column: "description",
			rowId,
		});
	const makeShared = (
		id: string,
		description: string,
		userId: string,
		day: number,
	) =>
		adminDb.sharedTransaction.create({
			data: {
				id,
				description,
				amount: "300",
				currency: "ARS",
				exchangeRate: "1000",
				date: d(day),
				paidByType: "user",
				paidById: userId,
				createdByType: "user",
				createdById: userId,
				splitParticipants: {
					create: [
						{
							participantType: "user" as const,
							participantId: userId,
							shareAmount: "100",
							verificationStatus: "ACCEPTED" as const,
						},
					],
				},
			},
		});
	const ask = (who: Who, q: string, extra: object = {}) =>
		titleSuggestions(who.db as PrismaClient, who.user.id, q, extra);

	it("counts sealed and plaintext descriptions of one text together", async () => {
		const who = await createTestUser();
		await makeShared("shsealed1", "Asado del domingo", who.user.id, 1);
		await makeShared(
			"shsealed2",
			sealShared("ASADO del domingo", "shsealed2"),
			who.user.id,
			2,
		);
		await makeShared(
			"shsealed3",
			sealShared("Asado del domingo", "shsealed3"),
			who.user.id,
			3,
		);
		const got = await ask(who, "asado", { keyring });
		expect(got.map((s) => [s.title, s.count])).toEqual([
			["Asado del domingo", 3],
		]);
		// The SQL path cannot read the sealed rows.
		expect((await ask(who, "asado")).map((s) => s.count)).toEqual([1]);
	});

	it("reads only the newest shared rows when the window is small", async () => {
		const who = await createTestUser();
		await makeShared("shwin1", "Window old", who.user.id, 1);
		await makeShared("shwin2", "Window old", who.user.id, 2);
		await makeShared("shwin3", "Window new", who.user.id, 3);
		const got = await ask(who, "window", { keyring, window: 1 });
		expect(got.map((s) => [s.title, s.count])).toEqual([["Window new", 1]]);
		const all = await ask(who, "window", { keyring, window: 10 });
		expect(all.map((s) => [s.title, s.count])).toEqual([
			["Window old", 2],
			["Window new", 1],
		]);
		expect(all).toEqual(await ask(who, "window"));
	});

	it("fails on a description sealed for another row", async () => {
		const who = await createTestUser();
		await makeShared(
			"shbad1",
			sealShared("Pan", "someotherrow"),
			who.user.id,
			1,
		);
		await expect(ask(who, "pan", { keyring })).rejects.toMatchObject({
			code: "auth_failed",
		});
	});
});
