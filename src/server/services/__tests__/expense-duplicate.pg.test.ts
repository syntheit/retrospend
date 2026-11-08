/**
 * The duplicate check on the SQL path (no keyring) and the app-layer path
 * (keyring), E2EE lane D7. On plaintext both must give the same answers, with
 * titles compared literally in any case: no trimming, no accent folding, and
 * `%`, `_` and backslash mean only themselves. Then the day edges in the
 * user's time zone, other currencies, other users, and sealed titles mixed
 * with plaintext.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
	FieldCryptoError,
	Keyring,
	sealField,
} from "~/server/crypto/field-crypto";
import { findDuplicateExpense } from "~/server/services/expense-duplicate";
import { ExpenseService } from "~/server/services/expense.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import type { PrismaClient } from "~prisma";

const keyring = new Keyring([{ id: 1, key: Buffer.alloc(32, 7) }]);
const PATHS = [
	["the SQL path (no keyring)", undefined],
	["the app-layer path (keyring)", keyring],
] as const;

const TZ = "America/Argentina/Buenos_Aires"; // UTC-3, no DST
/** Noon in Buenos Aires on 2026-10-14. */
const NOON = new Date("2026-10-14T15:00:00Z");

type Who = Awaited<ReturnType<typeof createTestUser>>;

type Row = {
	title: string;
	date?: Date;
	amount?: string;
	currency?: string;
	id?: string;
	extra?: Record<string, unknown>;
};

async function seed(user: Who, rows: Row[]) {
	await adminDb.expense.createMany({
		data: rows.map((r) => ({
			userId: user.user.id,
			title: r.title,
			date: r.date ?? NOON,
			amount: r.amount ?? "1500.5",
			currency: r.currency ?? "ARS",
			amountInUSD: "1",
			exchangeRate: "1000",
			pricingSource: "MANUAL",
			...(r.id ? { id: r.id } : {}),
			...r.extra,
		})),
	});
}

const seal = (id: string, title: string) =>
	sealField(keyring, title, { table: "expense", column: "title", rowId: id });

type Query = {
	title: string;
	amount?: string;
	currency?: string;
	date?: Date;
	timeZone?: string;
};

function find(who: Who, ring: Keyring | undefined, q: Query) {
	return findDuplicateExpense(
		who.db as PrismaClient,
		who.user.id,
		{
			title: q.title,
			amount: q.amount ?? "1500.5",
			currency: q.currency ?? "ARS",
			date: q.date ?? NOON,
			timeZone: q.timeZone ?? TZ,
		},
		{ keyring: ring },
	);
}

describe("title comparison is literal and case-insensitive", () => {
	// [stored, asked, duplicate], derived by hand: titles are equal when their
	// code points are equal after lower-casing each one separately. No trimming,
	// no accent folding, and `%`, `_` and backslash mean only themselves.
	const PAIRS: [string, string, boolean][] = [
		["Coffee", "Coffee", true],
		["Coffee", "coffee", true],
		["coffee", "COFFEE", true],
		["Coffee", "Coffe", false],
		["Coffee", "Coffee shop", false],
		["Coffee", " Coffee", false],
		["Coffee ", "Coffee", false],
		["Café", "Cafe", false],
		["Café", "CAFÉ", true],
		["ÁRBOL", "árbol", true],
		["İstanbul", "istanbul", true],
		["istanbul", "İSTANBUL", true],
		// Sigma lowers one code point at a time: capital sigma is never final.
		["ΣΊΣΥΦΟΣ", "σίσυφοσ", true],
		["ΣΊΣΥΦΟΣ", "σίσυφος", false],
		["ß", "SS", false],
		["ǅ", "ǆ", true],
		// The pattern characters of ILIKE.
		["50% off", "50% OFF", true],
		["50% off", "50_ off", false],
		["50% off", "50x off", false],
		["50% off", "%", false],
		["50% off", "50%", false],
		["a%b", "a%b", true],
		["axxb", "a%b", false],
		["a_b", "A_B", true],
		["axb", "a_b", false],
		["a_b", "a%b", false],
		["a\\b", "a\\b", true],
		["ab", "a\\b", false],
		["a\\b", "ab", false],
		["a\\%b", "a\\%b", true],
		["a%b", "a\\%b", false],
		["a\\%b", "a%b", false],
		["a\\\\b", "a\\\\b", true],
		["a\\b", "a\\\\b", false],
		// A lone trailing backslash is text, not an error.
		["Lunch\\", "Lunch\\", true],
		["Lunch\\", "LUNCH\\", true],
		["Lunch", "Lunch\\", false],
		["Lunch\\", "Lunch", false],
		["\\", "\\", true],
		["x", "\\", false],
		["_", "_", true],
		["x", "_", false],
		["%", "%", true],
		["x", "%", false],
	];

	for (const [label, ring] of PATHS) {
		describe(label, () => {
			let me: Who;
			beforeAll(async () => {
				me = await createTestUser();
				await seed(
					me,
					PAIRS.map(([stored], i) => ({
						title: stored,
						// One row per pair, each on its own amount so a pair can only
						// match the row it names.
						amount: String(1000 + i),
					})),
				);
			});

			PAIRS.forEach(([stored, asked, duplicate], i) => {
				it(`stored ${JSON.stringify(stored)}, asked ${JSON.stringify(asked)}: ${duplicate ? "duplicate" : "not a duplicate"}`, async () => {
					const now = await find(me, ring, {
						title: asked,
						amount: String(1000 + i),
					});
					expect(now === null).toBe(!duplicate);
				});
			});

			it("a pattern character in the asked title matches only itself among same-day rows", async () => {
				const user = await createTestUser();
				await seed(user, [
					{ title: "Lunch" },
					{ title: "Lunch1" },
					{ title: "50% off" },
					{ title: "50x off" },
					{ title: "a_c" },
					{ title: "abc" },
				]);
				for (const asked of ["%", "_", "Lunch\\", "50_ off", "a%c", "_bc"])
					expect(await find(user, ring, { title: asked })).toBeNull();
				expect((await find(user, ring, { title: "50% OFF" }))?.title).toBe(
					"50% off",
				);
				expect((await find(user, ring, { title: "A_C" }))?.title).toBe("a_c");
			});

			it("a trailing backslash does not throw", async () => {
				const user = await createTestUser();
				await seed(user, [{ title: "Lunch\\" }]);
				await expect(
					find(user, ring, { title: "Lunch\\" }),
				).resolves.toMatchObject({ title: "Lunch\\" });
				await expect(
					find(user, ring, { title: "Dinner\\" }),
				).resolves.toBeNull();
			});
		});
	}
});


for (const [label, ring] of PATHS) {
	describe(`duplicate check: ${label}`, () => {
		it("same day and amount with a different title is not a duplicate", async () => {
			const me = await createTestUser();
			await seed(me, [{ title: "Coffee" }, { title: "Taxi" }]);
			expect(await find(me, ring, { title: "Lunch" })).toBeNull();
			expect((await find(me, ring, { title: "Taxi" }))?.title).toBe("Taxi");
		});

		it("returns the stored title and id of the match", async () => {
			const me = await createTestUser();
			const id = randomUUID();
			await seed(me, [{ id, title: "Coffee" }]);
			expect(await find(me, ring, { title: "COFFEE" })).toEqual({
				id,
				title: "Coffee",
			});
		});

		it("does not trim, so a title with surrounding spaces is another title", async () => {
			const me = await createTestUser();
			await seed(me, [{ title: "Coffee " }]);
			expect(await find(me, ring, { title: "Coffee" })).toBeNull();
			expect((await find(me, ring, { title: "COFFEE " }))?.title).toBe(
				"Coffee ",
			);
		});

		it("needs the same amount, exactly", async () => {
			const me = await createTestUser();
			await seed(me, [{ title: "Coffee", amount: "1500.5" }]);
			expect(
				await find(me, ring, { title: "Coffee", amount: "1500.51" }),
			).toBeNull();
			expect(
				await find(me, ring, { title: "Coffee", amount: "1500.50" }),
			).not.toBeNull();
		});

		it("50 EUR is not a duplicate of 50 USD, and no currency matches any", async () => {
			const me = await createTestUser();
			await seed(me, [
				{ title: "Coffee", amount: "50", currency: "USD" },
				{ title: "Taxi", amount: "50", currency: "EUR" },
			]);
			const ask = (title: string, currency?: string) =>
				findDuplicateExpense(
					me.db as PrismaClient,
					me.user.id,
					{ title, amount: "50", currency, date: NOON, timeZone: TZ },
					{ keyring: ring },
				);
			expect(await ask("Coffee", "EUR")).toBeNull();
			expect(await ask("Coffee", "USD")).not.toBeNull();
			expect(await ask("Taxi", "USD")).toBeNull();
			expect(await ask("Taxi")).not.toBeNull();
		});

		it("never matches another user's expense", async () => {
			const me = await createTestUser();
			const other = await createTestUser();
			await seed(other, [{ title: "Coffee" }]);
			expect(await find(me, ring, { title: "Coffee" })).toBeNull();
			expect(await find(other, ring, { title: "Coffee" })).not.toBeNull();
		});

		it("filters by user itself, not only through row-level security", async () => {
			const me = await createTestUser();
			const other = await createTestUser();
			await seed(other, [{ title: "Coffee" }]);
			// The admin client sees every row, so only the query's own filter
			// keeps the other user's expense out.
			const ask = (userId: string) =>
				findDuplicateExpense(
					adminDb,
					userId,
					{
						title: "Coffee",
						amount: "1500.5",
						currency: "ARS",
						date: NOON,
						timeZone: TZ,
					},
					{ keyring: ring },
				);
			expect(await ask(me.user.id)).toBeNull();
			expect(await ask(other.user.id)).not.toBeNull();
		});

		it("ignores money in and entries that are not spending", async () => {
			const me = await createTestUser();
			await seed(me, [
				{
					title: "Coffee",
					amount: "10",
					extra: { direction: "IN", inType: "REFUND" },
				},
				{ title: "Taxi", amount: "10", extra: { entryKind: "ADJUSTMENT" } },
			]);
			const ask = (title: string) =>
				find(me, ring, { title, amount: "10" });
			expect(await ask("Coffee")).toBeNull();
			expect(await ask("Taxi")).toBeNull();
		});

		describe("the day is the user's, in their time zone", () => {
			// Buenos Aires is UTC-3: 2026-10-14 runs from 03:00Z to 03:00Z next day.
			const lateNight = new Date("2026-10-15T02:30:00Z"); // 23:30 on the 14th
			const midnight = new Date("2026-10-15T03:00:00Z"); // 00:00 on the 15th
			const justBefore = new Date("2026-10-14T02:59:59.999Z"); // 23:59 on the 13th

			it("an expense late on the 14th is a duplicate of one logged at noon that day", async () => {
				const me = await createTestUser();
				await seed(me, [{ title: "Coffee", date: lateNight }]);
				// 15:00Z on the 14th is the 14th in Buenos Aires and in UTC; the
				// stored row is the 15th in UTC, so only the user's day finds it.
				expect(await find(me, ring, { title: "Coffee" })).not.toBeNull();
			});

			it("an expense at local midnight starts the next day", async () => {
				const me = await createTestUser();
				await seed(me, [{ title: "Coffee", date: midnight }]);
				expect(await find(me, ring, { title: "Coffee" })).toBeNull();
				expect(
					await find(me, ring, { title: "Coffee", date: midnight }),
				).not.toBeNull();
			});

			it("the last millisecond of the 13th is not the 14th", async () => {
				const me = await createTestUser();
				await seed(me, [{ title: "Coffee", date: justBefore }]);
				expect(await find(me, ring, { title: "Coffee" })).toBeNull();
				expect(
					await find(me, ring, { title: "Coffee", date: justBefore }),
				).not.toBeNull();
			});

			it("the asked date can fall on either side of UTC midnight", async () => {
				const me = await createTestUser();
				await seed(me, [{ title: "Coffee", date: NOON }]);
				expect(
					await find(me, ring, { title: "Coffee", date: lateNight }),
				).not.toBeNull();
			});
		});
	});
}

describe("sealed titles (app-layer path)", () => {
	it("a sealed title matches its plaintext, in any case, next to plaintext rows", async () => {
		const me = await createTestUser();
		const sealedId = randomUUID();
		await seed(me, [
			{ id: sealedId, title: seal(sealedId, "Coffee") },
			{ title: "Taxi" },
		]);
		expect(await find(me, keyring, { title: "coffee" })).toEqual({
			id: sealedId,
			title: "Coffee",
		});
		expect((await find(me, keyring, { title: "TAXI" }))?.title).toBe("Taxi");
		expect(await find(me, keyring, { title: "Lunch" })).toBeNull();
	});

	it("the SQL path cannot see a sealed title, which is why a keyring picks the other path", async () => {
		const me = await createTestUser();
		const id = randomUUID();
		await seed(me, [{ id, title: seal(id, "Coffee") }]);
		expect(await find(me, undefined, { title: "Coffee" })).toBeNull();
		expect(await find(me, keyring, { title: "Coffee" })).not.toBeNull();
	});

	it("a sealed title is not matched by its ciphertext, or when the amount differs", async () => {
		const me = await createTestUser();
		const id = randomUUID();
		const sealed = seal(id, "Coffee");
		await seed(me, [{ id, title: sealed, amount: "20" }]);
		expect(
			await find(me, keyring, { title: sealed, amount: "20" }),
		).toBeNull();
		expect(
			await find(me, keyring, { title: "Coffee", amount: "21" }),
		).toBeNull();
	});

	it("a sealed title of another day, currency or user is never opened", async () => {
		const me = await createTestUser();
		const other = await createTestUser();
		const strayRing = new Keyring([{ id: 2, key: Buffer.alloc(32, 3) }]);
		const rows = [
			{ id: randomUUID(), date: new Date("2026-10-20T15:00:00Z") },
			{ id: randomUUID(), currency: "USD" },
		];
		await adminDb.expense.createMany({
			data: rows.map((r) => ({
				userId: me.user.id,
				id: r.id,
				title: sealField(strayRing, "Coffee", {
					table: "expense",
					column: "title",
					rowId: r.id,
				}),
				date: r.date ?? NOON,
				amount: "1500.5",
				currency: r.currency ?? "ARS",
				amountInUSD: "1",
				exchangeRate: "1000",
				pricingSource: "MANUAL",
			})),
		});
		const otherId = randomUUID();
		await seed(other, [
			{
				id: otherId,
				title: sealField(strayRing, "Coffee", {
					table: "expense",
					column: "title",
					rowId: otherId,
				}),
			},
		]);
		// Ciphertext under a key this keyring lacks would throw if it were opened.
		expect(await find(me, keyring, { title: "Coffee" })).toBeNull();
	});

	it("ciphertext the keyring cannot open is an error, never a silent non-match", async () => {
		const me = await createTestUser();
		const id = randomUUID();
		const strayRing = new Keyring([{ id: 2, key: Buffer.alloc(32, 3) }]);
		await seed(me, [
			{
				id,
				title: sealField(strayRing, "Coffee", {
					table: "expense",
					column: "title",
					rowId: id,
				}),
			},
		]);
		await expect(find(me, keyring, { title: "Coffee" })).rejects.toThrow(
			FieldCryptoError,
		);
	});

	it("a sealed value copied to another row does not open there", async () => {
		const me = await createTestUser();
		const home = randomUUID();
		await seed(me, [{ id: randomUUID(), title: seal(home, "Coffee") }]);
		await expect(find(me, keyring, { title: "Coffee" })).rejects.toThrow(
			FieldCryptoError,
		);
	});
});

describe("ExpenseService.findDuplicate", () => {
	it("passes the keyring through", async () => {
		const me = await createTestUser();
		const id = randomUUID();
		await seed(me, [{ id, title: seal(id, "Coffee") }]);
		const input = {
			title: "Coffee",
			amount: "1500.5",
			currency: "ARS",
			date: NOON,
			timeZone: TZ,
		};
		const service = new ExpenseService(me.db);
		expect(await service.findDuplicate(me.user.id, input)).toBeNull();
		expect(
			(await service.findDuplicate(me.user.id, input, { keyring }))?.id,
		).toBe(id);
	});

	for (const [label, options] of [
		["without a keyring", undefined],
		["with a keyring", { keyring }],
	] as const) {
		it(`a title ending in a backslash is asked and matched literally ${label}`, async () => {
			const me = await createTestUser();
			const id = randomUUID();
			await seed(me, [
				{ id, title: "Lunch\\" },
				{ title: "Lunch", amount: "1600" },
				{ title: "50% off", amount: "1700" },
				{ title: "50x off", amount: "1800" },
			]);
			const service = new ExpenseService(me.db);
			const ask = (title: string, amount = "1500.5") =>
				service.findDuplicate(
					me.user.id,
					{ title, amount, currency: "ARS", date: NOON, timeZone: TZ },
					options,
				);
			expect((await ask("Lunch\\"))?.id).toBe(id);
			expect((await ask("LUNCH\\"))?.id).toBe(id);
			expect(await ask("Dinner\\")).toBeNull();
			expect(await ask("Lunch\\", "1600")).toBeNull();
			expect(await ask("50_ off", "1700")).toBeNull();
			expect(await ask("50%", "1700")).toBeNull();
			expect(await ask("50% off", "1800")).toBeNull();
			expect((await ask("50% OFF", "1700"))?.title).toBe("50% off");
		});
	}
});
