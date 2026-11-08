/**
 * Import review with titles that may be ciphertext (ARS home): the
 * duplicate and "possibly already in Activity" matching (match.ts) and the
 * category suggestions (review.ts). Both compared titles in SQL or on
 * plaintext rows read from SQL; now stored titles are opened with
 * readUserText first, and suggestions have an app-layer path for a keyring.
 *
 * One ledger is built twice, with plain titles and with every title sealed,
 * and the review must come out the same on both and equal what is derived
 * by hand below. A plain ledger must also review the same on the SQL path
 * (no keyring) and the app path (keyring).
 *
 * Duplicate rows (existing at D0, file rows at D0 or D1):
 *   "Café Martínez" 7,800 vs "CAFE MARTINEZ" 7,800     exact (accents, case)
 *   "Coffee" 2,500 vs "MERPAGO*CAFE" 2,500 a day later  likely, shows "Coffee"
 *   "  Trim me  " 500 vs "TRIM ME" 500                  exact (spaces)
 *   "Libreria" 1,000 vs "Otra cosa" 1,001                none (amount differs)
 *
 * Suggestions (file title -> category its equal-ignoring-case titles were
 * filed under most). `equals insensitive` is lower(a) = lower(b): it does not
 * trim and does not fold accents, so these decoys must not count:
 *   Coto x1 Groceries, COTO x1 Groceries, coto x1 Health      for "COTO"
 *   "Coto " x2 and "Cotó" x1 Transport (3, would win if folded) -> Groceries
 *   ÑANDÚ x1 Health   "ñandú" -> Health;   "nandu" -> nothing
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
	FieldCryptoError,
	Keyring,
	sealField,
} from "~/server/crypto/field-crypto";
import { adminDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
import {
	arsUser,
	daysAgo,
	isoDay,
	seedArsRates,
} from "../accounts/test-fixtures";
import { importReview } from "./review";

const keyring = new Keyring([{ id: 1, key: Buffer.alloc(32, 3) }]);

beforeAll(seedArsRates);

const D0 = isoDay(daysAgo(5));
const D1 = isoDay(daysAgo(4));

type Seed = { title: string; amount: number; day?: string; category?: string };

async function ledger(sealed: boolean) {
	const userId = (await arsUser()).user.id;
	const cats: Record<string, string> = {};
	for (const name of ["Groceries", "Health", "Transport"])
		cats[name] = (
			await adminDb.category.create({ data: { userId, name, color: "teal" } })
		).id;
	const store = async (r: Seed, daysBack: number) => {
		const id = randomUUID();
		await adminDb.expense.create({
			data: {
				id,
				userId,
				title: sealed
					? sealField(keyring, r.title, {
							table: "expense",
							column: "title",
							rowId: id,
						})
					: r.title,
				amount: r.amount,
				currency: "ARS",
				date: new Date(
					`${r.day ?? isoDay(daysAgo(daysBack))}T15:00:00.000Z`,
				),
				exchangeRate: 1468,
				amountInUSD: 1,
				pricingSource: "MANUAL",
				categoryId: r.category ? cats[r.category] : null,
			},
		});
	};
	for (const r of [
		{ title: "Café Martínez", amount: 7800, day: D0 },
		{ title: "Coffee", amount: 2500, day: D0 },
		{ title: "  Trim me  ", amount: 500, day: D0 },
		{ title: "Libreria", amount: 1000, day: D0 },
	])
		await store(r, 0);
	// Newest first, so a small window sees the Transport decoys only.
	const filed: Seed[] = [
		{ title: "Coto ", amount: 11, category: "Transport" },
		{ title: "Coto ", amount: 12, category: "Transport" },
		{ title: "Cotó", amount: 13, category: "Transport" },
		{ title: "Coto", amount: 14, category: "Groceries" },
		{ title: "COTO", amount: 15, category: "Groceries" },
		{ title: "coto", amount: 16, category: "Health" },
		{ title: "ÑANDÚ", amount: 17, category: "Health" },
	];
	for (const [i, r] of filed.entries()) await store(r, 40 + i);
	return { userId, cats };
}

const fileRow = (title: string, amount: number, day: string, cat = "") => ({
	title,
	amount,
	currency: "ARS",
	date: day,
	location: "",
	description: "",
	pricingSource: "IMPORT",
	category: cat,
});

async function job(userId: string) {
	const rows = [
		fileRow("CAFE MARTINEZ", 7800, D0),
		fileRow("MERPAGO*CAFE", 2500, D1),
		fileRow("TRIM ME", 500, D0),
		fileRow("Otra cosa", 1001, D0),
		fileRow("COTO", 9001, D0, "Super"),
		fileRow("ñandú", 9002, D0, "Fiesta"),
		fileRow("nandu", 9003, D0, "Otros"),
	];
	return (
		await adminDb.importJob.create({
			data: {
				userId,
				status: "READY_FOR_REVIEW",
				type: "CSV",
				fileName: "statement.csv",
				fileSize: 1,
				fileType: "csv",
				transactions: rows as unknown as Prisma.InputJsonValue,
			},
		})
	).id;
}

/** The parts of a review that depend on matching, with suggestions named, not id'd. */
async function reviewOf(
	l: Awaited<ReturnType<typeof ledger>>,
	options: Parameters<typeof importReview>[3] = {},
) {
	const r = await importReview(adminDb, l.userId, await job(l.userId), options);
	const name = (id: string | null) =>
		Object.entries(l.cats).find(([, v]) => v === id)?.[0] ?? null;
	return {
		rows: r.rows.map((x) => [x.title, x.duplicate, x.possible] as const),
		unmatched: r.unmatched.map((u) => [
			u.name,
			u.rows,
			name(u.suggestionId),
		]),
	};
}

const EXPECTED = {
	rows: [
		["CAFE MARTINEZ", true, null],
		["MERPAGO*CAFE", false, { title: "Coffee", date: D0 }],
		["TRIM ME", true, null],
		["Otra cosa", false, null],
		["COTO", false, null],
		["ñandú", false, null],
		["nandu", false, null],
	],
	unmatched: [
		["Super", 1, "Groceries"],
		["Fiesta", 1, "Health"],
		["Otros", 1, null],
	],
};

describe("import review over plain and sealed titles", () => {
	it("a plain ledger reviews as derived on the SQL path", async () => {
		expect(await reviewOf(await ledger(false))).toEqual(EXPECTED);
	});

	it("a plain ledger reviews the same on the app path", async () => {
		expect(await reviewOf(await ledger(false), { keyring })).toEqual(EXPECTED);
	});

	it("a sealed ledger reviews the same as the plain one", async () => {
		expect(await reviewOf(await ledger(true), { keyring })).toEqual(EXPECTED);
	});

	it("sealed titles with no keyring are an error, not a missed duplicate", async () => {
		await expect(reviewOf(await ledger(true))).rejects.toBeInstanceOf(
			FieldCryptoError,
		);
	});

	it("the app path reads only the newest rows for suggestions", async () => {
		// The newest three categorized rows are the Transport decoys, which
		// match nothing equal to "COTO", "ñandú" or "nandu".
		const r = await reviewOf(await ledger(true), {
			keyring,
			suggestionWindow: 3,
		});
		expect(r.rows).toEqual(EXPECTED.rows);
		expect(r.unmatched).toEqual([
			["Super", 1, null],
			["Fiesta", 1, null],
			["Otros", 1, null],
		]);
	});
});
