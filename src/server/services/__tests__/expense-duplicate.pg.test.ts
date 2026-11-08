/**
 * The duplicate check on the SQL path (no keyring) and the app-layer path
 * (keyring), E2EE lane D7. On plaintext both must answer what the old query
 * answered (copied below as the oracle), including how titles compare: any
 * case, but no trimming and no accent folding, and `%` and `_` are ordinary
 * characters. Then the day edges in the user's time zone, other currencies,
 * other users, and sealed titles mixed with plaintext.
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

/** The query as it was before D7: the title was part of the SQL filter. */
async function oldFind(who: Who, q: Query & { title: string }) {
	const startOfDay = new Date("2026-10-14T03:00:00Z");
	const endOfDay = new Date(startOfDay.getTime() + 86_400_000 - 1);
	return await (who.db as PrismaClient).expense.findFirst({
		where: {
			userId: who.user.id,
			direction: "OUT",
			entryKind: "STANDARD",
			title: { equals: q.title, mode: "insensitive" },
			amount: { equals: q.amount ?? "1500.5" },
			currency: q.currency ?? "ARS",
			date: { gte: startOfDay, lte: endOfDay },
		},
		select: { id: true, title: true },
	});
}

describe("title comparison matches the old query on plaintext", () => {
	// [stored, asked]: where the old query said yes or no is the oracle, so the
	// pairs only need to cover the ways two titles can differ.
	const PAIRS: [string, string][] = [
		["Coffee", "Coffee"],
		["Coffee", "coffee"],
		["coffee", "COFFEE"],
		["Coffee", "Coffe"],
		["Coffee", "Coffee shop"],
		["Coffee", " Coffee"],
		["Coffee ", "Coffee"],
		["Café", "Cafe"],
		["Café", "CAFÉ"],
		["ÁRBOL", "árbol"],
		["50% off", "50% OFF"],
		["50% off", "50_ off"],
		["50% off", "%"],
		["100_a", "100xa"],
		["a\\b", "a\\b"],
		["İstanbul", "istanbul"],
		["istanbul", "İSTANBUL"],
		["ΣΊΣΥΦΟΣ", "σίσυφος"],
		["ΣΊΣΥΦΟΣ", "σίσυφοσ"],
		["ß", "SS"],
		["ǅ", "ǆ"],
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

			PAIRS.forEach(([stored, asked], i) => {
				it(`stored ${JSON.stringify(stored)}, asked ${JSON.stringify(asked)}`, async () => {
					const q = { title: asked, amount: String(1000 + i) };
					const before = await oldFind(me, q);
					const now = await find(me, ring, q);
					expect(now === null).toBe(before === null);
					if (before) expect(now?.id).toBe(before.id);
				});
			});

			it("has pairs the old query said yes to and pairs it said no to", async () => {
				const answers = await Promise.all(
					PAIRS.map(async ([, asked], i) =>
						Boolean(await oldFind(me, { title: asked, amount: String(1000 + i) })),
					),
				);
				expect(answers).toContain(true);
				expect(answers).toContain(false);
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
});
