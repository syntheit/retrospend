/**
 * The other app-layer text matches over every row in batches (E2EE D11 PR
 * 5.2): title suggestions (personal and shared), import review suggestions,
 * people search and the people picker. Batches of 3 here (and id chunks of 3,
 * taken in id order), so a handful of rows spans several: a match only in the
 * third batch is found, results and limits are what the SQL path gives, a row
 * edited between batches counts once, and a key the ring lacks fails the
 * request retryably in a later batch.
 *
 * It runs in both pg suites. The app-layer path is the one once the field
 * encryption epoch exists: the sealed suite writes it (and seals every row),
 * the plain suite marks it in this process's cache only, and clears it to
 * compare with the SQL path.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { peopleRouter } from "~/server/api/routers/people";
import { createCallerFactory } from "~/server/api/trpc";
import { ref, seedShare } from "~/server/api/v1/__tests__/g3-fixtures";
import { markEpochActive, resetEpochForTests } from "~/server/crypto/epoch";
import { textUnavailableProblem } from "~/server/crypto/field-open";
import { createUserScopedDb } from "~/server/db";
import {
	arsUser,
	daysAgo,
	isoDay,
	seedArsRates,
} from "~/server/services/accounts/test-fixtures";
import { importReview } from "~/server/services/import/review";
import {
	searchPeople,
	shadowsMatching,
} from "~/server/services/search.service";
import { titleSuggestions } from "~/server/services/title-suggestions.service";
import {
	adminDb,
	createTestUser,
	fixtureDb,
	fixtureNameIndex,
	sealedSuite,
} from "~/test/pg-harness";
import { restoreCells, storedValue, writeCell } from "~/test/sealed-fixture";
import { makeSession } from "~/test/trpc-test-utils";
import type { Prisma } from "~prisma";

/** Batches (and id chunks) read in this request, and a hook before the n-th. */
const batches = vi.hoisted(() => ({
	n: 0,
	before: undefined as ((n: number) => Promise<void> | void) | undefined,
}));
vi.mock("~/server/services/scan-batches", async (importOriginal) => {
	const real =
		await importOriginal<typeof import("~/server/services/scan-batches")>();
	const counted = async () => {
		batches.n++;
		await batches.before?.(batches.n);
	};
	const scanBatches: typeof real.scanBatches = (db, userId, scan) =>
		real.scanBatches(db, userId, {
			...scan,
			batch: 3,
			read: async (tx, after, take) => {
				await counted();
				return scan.read(tx, after, take);
			},
		});
	const scanIds: typeof real.scanIds = (db, userId, ids, read) =>
		real.scanIds(
			db,
			userId,
			[...ids].sort(),
			async (tx, chunk) => {
				await counted();
				return read(tx, chunk);
			},
			3,
		);
	return { ...real, scanBatches, scanIds };
});

/** Runs `request` with the batch count at zero and `before` hooked in. */
async function counted<T>(
	request: () => Promise<T>,
	before?: (n: number) => Promise<void> | void,
): Promise<{ result: T; batches: number }> {
	batches.n = 0;
	batches.before = before;
	try {
		const result = await request();
		return { result, batches: batches.n };
	} finally {
		batches.before = undefined;
	}
}

/** The plain suite only: `request` on the SQL path, as before the epoch. */
async function onSqlPath<T>(request: () => Promise<T>): Promise<T> {
	resetEpochForTests();
	try {
		return await request();
	} finally {
		markEpochActive();
	}
}

beforeAll(async () => {
	if (!sealedSuite) markEpochActive();
	await seedArsRates();
});
afterAll(restoreCells);

type Who = Awaited<ReturnType<typeof createTestUser>>;
const at = (day: number) =>
	new Date(`2026-10-${String(day).padStart(2, "0")}T12:00:00Z`);

async function expense(
	who: Who,
	title: string,
	date: Date,
	extra: Record<string, unknown> = {},
): Promise<string> {
	const row = await fixtureDb.expense.create({
		data: {
			userId: who.user.id,
			title,
			date,
			amount: "1500",
			currency: "ARS",
			amountInUSD: "1.5",
			exchangeRate: "1000",
			pricingSource: "MANUAL",
			...extra,
		},
	});
	return row.id;
}

async function shared(who: Who, description: string, date: Date) {
	await adminDb.sharedTransaction.create({
		data: {
			id: randomUUID(),
			description,
			amount: "3000",
			currency: "ARS",
			exchangeRate: "1000",
			date,
			paidByType: "user",
			paidById: who.user.id,
			createdByType: "user",
			createdById: who.user.id,
			splitParticipants: {
				create: {
					participantType: "user",
					participantId: who.user.id,
					shareAmount: "3000",
					verificationStatus: "ACCEPTED",
				},
			},
		},
	});
}

const newCategory = async (who: Who, name: string) =>
	fixtureDb.category.create({
		data: {
			userId: who.user.id,
			name,
			nameIndex: await fixtureNameIndex(who.user.id, name),
			color: "teal",
		},
	});

/** Points a sealed cell at key 9, which the loaded ring does not hold. */
async function unknownKey(table: string, column: string, id: string) {
	const sealed = await storedValue(table, column, id);
	if (typeof sealed !== "string" || !sealed.startsWith("\u0001k1:"))
		throw new Error(`${table}.${column} is not sealed`);
	const raw = Buffer.from(sealed.slice(4), "base64");
	raw.writeUInt32BE(9, 0);
	await writeCell(table, column, id, `\u0001k1:${raw.toString("base64")}`);
}

const suggest = (who: Who, q: string) =>
	titleSuggestions(who.db, who.user.id, q);

describe("title suggestions", () => {
	it("find a personal title only in the third batch", async () => {
		const who = await createTestUser();
		for (let i = 0; i < 6; i++) await expense(who, `Filler ${i}`, at(20 - i));
		await expense(who, "Mate cocido", at(10), { amount: "2750" });
		const { result, batches: read } = await counted(() => suggest(who, "MATE"));
		expect(result).toEqual([
			{
				title: "Mate cocido",
				count: 1,
				lastCategoryId: null,
				lastAmount: 2750,
				lastCurrency: "ARS",
			},
		]);
		// Personal: 3 + 3 + 1 rows; shared: one empty batch.
		expect(read).toBe(4);
	});

	it("find a shared description only in the third batch", async () => {
		const who = await createTestUser();
		for (let i = 0; i < 6; i++) await shared(who, `Cena ${i}`, at(20 - i));
		await shared(who, "Asado de Martín", at(10));
		expect(await suggest(who, "martín")).toEqual([
			{
				title: "Asado de Martín",
				count: 1,
				lastCategoryId: null,
				lastAmount: null,
				lastCurrency: null,
			},
		]);
	});

	describe("rank as the SQL path does across batches", () => {
		let who: Who;
		beforeAll(async () => {
			who = await arsUser();
			const category = await newCategory(who, "Café");
			// Newest first. "café" matches Café and CAFÉ (one case-insensitive
			// group, 3 + 2) but not "cafe" (no accent folding); its last use is
			// the newest row titled exactly "Café", ARS 4,500.50, not CAFÉ.
			const rows: [string, string][] = [
				["CAFÉ", "9999"],
				["Café", "4500.50"],
				["cafe", "100"],
				["CAFÉ", "200"],
				["Café", "300"],
				["Café", "400"],
			];
			for (const [i, [title, amount]] of rows.entries())
				await expense(who, title, at(28 - i), {
					amount,
					categoryId: category.id,
				});
			// Nine titles used once: the top 8 by text, so "Tie i" is cut.
			for (const [i, c] of [..."abcdefghi"].entries())
				await expense(who, `Tie ${c}`, at(20 - i));
			await shared(who, "café con leche", at(5));
			await shared(who, "TIE A", at(5));
		});

		it("groups case-insensitively, without folding accents", async () => {
			const got = await suggest(who, "café");
			expect(
				got.map((s) => [s.title, s.count, s.lastAmount, s.lastCurrency]),
			).toEqual([
				["Café", 5, 4500.5, "ARS"],
				["café con leche", 1, null, null],
			]);
			if (!sealedSuite)
				expect(got).toEqual(await onSqlPath(() => suggest(who, "café")));
		});

		it("keeps the top 8, ties by text, shared counts merged", async () => {
			const got = await suggest(who, "tie");
			expect(got.map((s) => [s.title, s.count])).toEqual([
				["Tie a", 2],
				["Tie b", 1],
				["Tie c", 1],
				["Tie d", 1],
				["Tie e", 1],
				["Tie f", 1],
				["Tie g", 1],
				["Tie h", 1],
			]);
			if (!sealedSuite)
				expect(got).toEqual(await onSqlPath(() => suggest(who, "tie")));
		});
	});

	it("count a row whose date moves back between batches once", async () => {
		const who = await createTestUser();
		const ids: string[] = [];
		for (let i = 0; i < 6; i++)
			ids.push(await expense(who, "Edit", at(20 - i)));
		const { result } = await counted(
			() => suggest(who, "edit"),
			async (n) => {
				if (n === 2)
					await adminDb.expense.update({
						where: { id: ids[0] ?? "" },
						data: { date: at(1) },
					});
			},
		);
		expect(result.map((s) => [s.title, s.count])).toEqual([["Edit", 6]]);
	});

	it("fail retryably on a key the ring lacks in a later batch", async ({
		skip,
	}) => {
		skip(!sealedSuite, "needs the sealed suite's keys and sealed rows");
		const who = await createTestUser();
		for (let i = 0; i < 6; i++) await expense(who, `Filler ${i}`, at(20 - i));
		const last = await expense(who, "Oldest", at(10));
		await unknownKey("expense", "title", last);
		vi.spyOn(console, "error").mockImplementation(() => {});
		const failed = await counted(() =>
			suggest(who, "zzz").then(
				() => null,
				(error: unknown) => error,
			),
		);
		expect(textUnavailableProblem(failed.result)).toBe("key_rotated");
		expect(failed.batches).toBe(3);
		vi.restoreAllMocks();
	});
});

describe("import review suggestions", () => {
	const D0 = isoDay(daysAgo(5));

	async function ledger() {
		const who = await arsUser();
		const cats: Record<string, string> = {};
		for (const name of ["Groceries", "Health", "Transport"])
			cats[name] = (await newCategory(who, name)).id;
		/** Categorized rows, newest first. */
		const filed = async (rows: [string, string][]) => {
			const ids: string[] = [];
			for (const [i, [title, cat]] of rows.entries())
				ids.push(
					await expense(who, title, daysAgo(40 + i), {
						categoryId: cats[cat],
					}),
				);
			return ids;
		};
		return { who, cats, filed };
	}

	async function review(l: Awaited<ReturnType<typeof ledger>>) {
		const job = await fixtureDb.importJob.create({
			data: {
				userId: l.who.user.id,
				status: "READY_FOR_REVIEW",
				type: "CSV",
				fileName: "statement.csv",
				fileSize: 1,
				fileType: "csv",
				transactions: [
					{
						title: "COTO",
						amount: 9001,
						currency: "ARS",
						date: D0,
						location: "",
						description: "",
						pricingSource: "IMPORT",
						category: "Super",
					},
				] as unknown as Prisma.InputJsonValue,
			},
		});
		const r = await importReview(
			createUserScopedDb(l.who.user.id),
			l.who.user.id,
			job.id,
		);
		const name = (id: string | null) =>
			Object.entries(l.cats).find(([, v]) => v === id)?.[0] ?? null;
		return r.unmatched.map((u) => [u.name, u.rows, name(u.suggestionId)]);
	}

	it("find a title only in the third batch", async () => {
		const l = await ledger();
		await l.filed([
			...Array.from(
				{ length: 6 },
				(_, i) => [`Decoy ${i}`, "Transport"] as [string, string],
			),
			["Coto", "Groceries"],
		]);
		expect(await review(l)).toEqual([["Super", 1, "Groceries"]]);
	});

	it("count rows whose date moves back between batches once", async () => {
		const l = await ledger();
		// Health 2, Groceries 3: Groceries. Read twice, Health would make 4.
		const ids = await l.filed([
			["coto", "Health"],
			["COTO", "Health"],
			["Coto", "Groceries"],
			["Coto", "Groceries"],
			["Coto", "Groceries"],
			["Decoy", "Transport"],
		]);
		const { result } = await counted(
			() => review(l),
			async (n) => {
				if (n !== 2) return;
				for (const [i, id] of ids.slice(0, 2).entries())
					await adminDb.expense.update({
						where: { id },
						data: { date: daysAgo(100 + i) },
					});
			},
		);
		expect(result).toEqual([["Super", 1, "Groceries"]]);
	});

	it("fail retryably on a key the ring lacks in a later batch", async ({
		skip,
	}) => {
		skip(!sealedSuite, "needs the sealed suite's keys and sealed rows");
		const l = await ledger();
		const ids = await l.filed(
			Array.from(
				{ length: 7 },
				(_, i) => [`Decoy ${i}`, "Transport"] as [string, string],
			),
		);
		await unknownKey("expense", "title", ids[6] ?? "");
		vi.spyOn(console, "error").mockImplementation(() => {});
		const failed = await review(l).then(
			() => null,
			(error: unknown) => error,
		);
		expect(textUnavailableProblem(failed)).toBe("key_rotated");
		vi.restoreAllMocks();
	});
});

describe("people", () => {
	const named = async (name: string, createdAt: Date) => {
		const u = await arsUser();
		await adminDb.user.update({
			where: { id: u.user.id },
			data: { name, createdAt },
		});
		return u;
	};
	const ghost = (me: Who, name: string, createdAt: Date) =>
		adminDb.shadowProfile.create({
			data: { createdById: me.user.id, name, createdAt },
		});
	const picker = (me: Who) =>
		createCallerFactory(peopleRouter)({
			session: makeSession({ id: me.user.id, name: me.user.name }),
			db: me.db,
			headers: new Headers(),
		});

	it("search finds a ghost and a user only in the third batch", async () => {
		const me = await arsUser();
		for (let i = 0; i < 6; i++) await ghost(me, `Filler ${i}`, at(20 - i));
		await ghost(me, "Martín Muñoz", at(10));
		// Seven people I share with; chunks go in id order, so the match is
		// the one whose id sorts last.
		const people = [];
		for (let i = 0; i < 7; i++) {
			const u = await named(`Other ${i}`, at(20 - i));
			await seedShare(ref(me), ref(u), "10", "ARS");
			people.push(u);
		}
		const last = people.map((u) => u.user.id).sort()[6] ?? "";
		await adminDb.user.update({
			where: { id: last },
			data: { name: "MUÑOZ Pérez" },
		});
		const { result, batches: read } = await counted(() =>
			searchPeople(me.db, me.user.id, "munoz", { after: null, take: 10 }),
		);
		// By code point: "U" sorts before "a".
		expect(result.map((r) => [r.participantType, r.name])).toEqual([
			["user", "MUÑOZ Pérez"],
			["shadow", "Martín Muñoz"],
		]);
		expect(result[0]?.id).toBe(last);
		// Users: 3 + 3 + 1 ids; ghosts: 3 + 3 + 1 rows.
		expect(read).toBe(6);
	});

	it("search sorts by name across batches", async () => {
		const me = await arsUser();
		for (const [i, name] of [
			"Zoe Sort",
			"ana sort",
			"Ángel Sort",
			"Bea Sort",
		].entries())
			await ghost(me, name, at(20 - i));
		for (const [i, name] of [
			"Carla Sort",
			"Ánibal Sort",
			"beto sort",
		].entries()) {
			const u = await named(name, at(20 - i));
			await seedShare(ref(me), ref(u), "10", "ARS");
		}
		const page = (
			after: { name: string; participantType: string; id: string } | null,
		) => searchPeople(me.db, me.user.id, "SORT", { after, take: 4 });
		const first = await page(null);
		const tail = first.at(-1);
		if (!tail) throw new Error("no first page");
		const second = await page(tail);
		// By code point, as the old ORDER BY: capitals, then small letters,
		// then accented capitals.
		expect([...first, ...second].map((r) => r.name)).toEqual([
			"Bea Sort",
			"Carla Sort",
			"Zoe Sort",
			"ana sort",
			"beto sort",
			"Ángel Sort",
			"Ánibal Sort",
		]);
	});

	it("ghosts stop reading once the limit matches", async () => {
		const me = await arsUser();
		for (let i = 0; i < 7; i++) await ghost(me, `Stop ${i}`, at(20 - i));
		const { result, batches: read } = await counted(() =>
			shadowsMatching(me.db, me.user.id, (s) => s.name.startsWith("Stop"), 4),
		);
		expect(result.map((s) => s.name)).toEqual([
			"Stop 0",
			"Stop 1",
			"Stop 2",
			"Stop 3",
		]);
		expect(read).toBe(2);
	});

	it("the picker finds the newest 10 ghosts and 10 contacts across batches", async () => {
		const me = await arsUser();
		for (let i = 1; i <= 12; i++) {
			await ghost(me, `Pick ghost ${i}`, at(i));
			const u = await named(`Pick user ${i}`, at(i));
			await seedShare(ref(me), ref(u), "10", "ARS");
		}
		const newest = (kind: string) =>
			Array.from({ length: 10 }, (_, i) => `Pick ${kind} ${12 - i}`);
		const out = await picker(me).search({ query: "PICK" });
		expect(out.shadows.map((s) => s.name)).toEqual(newest("ghost"));
		expect(out.users.map((u) => u.name)).toEqual(newest("user"));
	});

	it("the picker finds a ghost and a contact only in the third batch", async () => {
		const me = await arsUser();
		for (let i = 0; i < 6; i++) {
			await ghost(me, `Filler ${i}`, at(20 - i));
			const u = await named(`Filler user ${i}`, at(20 - i));
			await seedShare(ref(me), ref(u), "10", "ARS");
		}
		await ghost(me, "Ñandú ghost", at(10));
		const u = await named("ÑANDÚ user", at(10));
		await seedShare(ref(me), ref(u), "10", "ARS");
		const out = await picker(me).search({ query: "ñandú" });
		expect(out.shadows.map((s) => s.name)).toEqual(["Ñandú ghost"]);
		expect(out.users.map((x) => x.name)).toEqual(["ÑANDÚ user"]);
	});
});
