/**
 * The app-layer searches over every row in batches (scan-batches.ts), with a
 * batch of 3 so a handful of rows spans several: v1 expense search and each
 * Activity source find a match that sits only in the third batch, ties and
 * edits across a batch boundary count once, the cursor and the first page's
 * count hold across batches, and the path is picked once per request.
 *
 * It runs in both pg suites. The app-layer path is the one once the field
 * encryption epoch exists: the sealed suite writes it (and seals every row),
 * the plain suite marks it in this process's cache only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { markEpochActive, resetEpochForTests } from "~/server/crypto/epoch";
import { textUnavailableProblem } from "~/server/crypto/field-open";
import { listActivity } from "~/server/services/expense-list";
import { listV2Input } from "~/server/services/expense-list/types";
import { searchExpenses } from "~/server/services/search.service";
import {
	adminDb,
	createTestUser,
	fixtureDb,
	sealedSuite,
} from "~/test/pg-harness";
import { restoreCells, storedValue, writeCell } from "~/test/sealed-fixture";

/** Every userTransaction a request opens, and a hook that runs before the n-th. */
const txs = vi.hoisted(() => ({
	n: 0,
	before: undefined as ((n: number) => Promise<void> | void) | undefined,
}));
vi.mock("~/server/db-tx", async (importOriginal) => {
	const real = await importOriginal<typeof import("~/server/db-tx")>();
	const userTransaction: typeof real.userTransaction = async (...args) => {
		txs.n++;
		await txs.before?.(txs.n);
		return real.userTransaction(...args);
	};
	return { ...real, userTransaction };
});

/** Runs `request` with the counter at zero and `before` hooked in. */
async function counted<T>(
	request: () => Promise<T>,
	before?: (n: number) => Promise<void> | void,
): Promise<{ result: T; txs: number }> {
	txs.n = 0;
	txs.before = before;
	try {
		const result = await request();
		return { result, txs: txs.n };
	} finally {
		txs.before = undefined;
	}
}

const BATCH = 3;
const at = (day: number) =>
	new Date(`2026-10-${String(day).padStart(2, "0")}T12:00:00Z`);

beforeAll(() => {
	if (!sealedSuite) markEpochActive();
});
afterAll(restoreCells);

type Who = Awaited<ReturnType<typeof createTestUser>>;

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

/** Six non-matching expenses, newer than anything else, then `last` alone in the third batch. */
async function thirdBatch(who: Who, last: (date: Date) => Promise<string>) {
	for (let i = 0; i < 6; i++) await expense(who, `Filler ${i}`, at(20 - i));
	return last(at(10));
}

const activity = (who: Who, q: string, extra: object = {}) =>
	listActivity(
		adminDb,
		who.user.id,
		listV2Input.parse({ q, limit: 50, ...extra }),
		"UTC",
		new Date("2026-10-21T15:00:00Z"),
		{ batch: BATCH },
	);

const v1 = (
	who: Who,
	q: string,
	take: number,
	after: { date: string; id: string } | null = null,
) => searchExpenses(adminDb, who.user.id, q, { after, take }, { batch: BATCH });

describe("a match only in the third batch", () => {
	it("v1 search finds it, and stops reading once the page is full", async () => {
		const who = await createTestUser();
		const mate = await thirdBatch(who, (d) => expense(who, "Mate cocido", d));
		const found = await counted(() => v1(who, "MATE", 5));
		expect(found.result.map((r) => r.id)).toEqual([mate]);
		expect(found.result[0]?.title).toBe("Mate cocido");
		// Batches of 3 over 7 rows.
		expect(found.txs).toBe(3);
		const two = await counted(() => v1(who, "filler", 2));
		expect(two.result.map((r) => r.title)).toEqual(["Filler 0", "Filler 1"]);
		expect(two.txs).toBe(1);
	});

	it("Activity finds a personal expense there", async () => {
		const who = await createTestUser();
		const mate = await thirdBatch(who, (d) => expense(who, "Mate cocido", d));
		const page = await activity(who, "mate");
		expect(page.items.map((i) => i.id)).toEqual([mate]);
		expect(page.count).toBe(1);
	});

	it("Activity finds a shared expense there, by its notes", async () => {
		const who = await createTestUser();
		const payer = await createTestUser();
		const shared = async (description: string, notes: string, date: Date) => {
			const id = randomUUID();
			await adminDb.sharedTransaction.create({
				data: {
					id,
					description,
					notes,
					amount: "3000",
					currency: "ARS",
					exchangeRate: "1000",
					date,
					paidByType: "user",
					paidById: payer.user.id,
					createdByType: "user",
					createdById: payer.user.id,
					splitParticipants: {
						create: [who, payer].map((p) => ({
							participantType: "user",
							participantId: p.user.id,
							shareAmount: "1500",
							verificationStatus: "ACCEPTED" as const,
						})),
					},
				},
			});
			return id;
		};
		for (let i = 0; i < 6; i++) await shared(`Cena ${i}`, "", at(20 - i));
		const found = await shared("Cena", "Cumpleaños de Martín", at(10));
		const page = await activity(who, "cumpleanos");
		expect(page.items.map((i) => i.id)).toEqual([`shared:${found}`]);
	});

	it("Activity finds a payment there by its method alone", async () => {
		const who = await createTestUser();
		const other = await createTestUser();
		const payment = async (method: string | null, date: Date) => {
			const id = randomUUID();
			await adminDb.settlement.create({
				data: {
					id,
					fromParticipantType: "user",
					fromParticipantId: other.user.id,
					toParticipantType: "user",
					toParticipantId: who.user.id,
					currency: "ARS",
					amount: "7500",
					status: "FINALIZED",
					initiatedAt: date,
					paymentMethod: method,
				},
			});
			return id;
		};
		for (let i = 0; i < 6; i++) await payment("Efectivo", at(20 - i));
		const found = await payment("Mercado Pago", at(10));
		const page = await activity(who, "mercado");
		expect(page.items.map((i) => i.id)).toEqual([`payment:${found}|ARS`]);
	});

	it("an ARS home finds a blue-rate expense by its amount, written any way", async () => {
		const who = await createTestUser();
		await adminDb.user.update({
			where: { id: who.user.id },
			data: { homeCurrency: "ARS" },
		});
		// USD 64,000.00 booked at the blue rate 1 USD = 1,545 ARS:
		// 64,000 x 1,545 = 98,880,000.00 ARS.
		const blue = await thirdBatch(who, (d) =>
			expense(who, "Notebook", d, {
				amount: "64000",
				currency: "USD",
				amountInUSD: "64000",
				exchangeRate: "1",
				pricingSource: "blue",
				rateType: "blue",
				homeCurrency: "ARS",
				homeRate: "1545",
				homeAmount: "98880000",
			}),
		);
		for (const q of ["64000", "64.000", "64,000"]) {
			const page = await activity(who, q);
			expect(
				page.items.map((i) => i.id),
				q,
			).toEqual([blue]);
			expect(page.items[0], q).toMatchObject({
				title: "Notebook",
				amount: { minor: 6_400_000, currency: "USD" },
				home: { minor: 9_888_000_000, currency: "ARS" },
			});
		}
		const v1Hits = await v1(who, "notebook", 5);
		expect(v1Hits.map((r) => [r.id, r.currency])).toEqual([[blue, "USD"]]);
		expect(v1Hits[0]?.title.startsWith("\u0001")).toBe(false);
	});
});

describe("across batch boundaries", () => {
	let who: Who;
	/** Every "tie" match in page order. */
	let order: string[];

	beforeAll(async () => {
		who = await createTestUser();
		await expense(who, "Filler new", at(20));
		// Five rows with one date and one createdAt: the id breaks the tie,
		// and the first batch boundary falls among them.
		const same = new Date("2026-10-15T15:00:00Z");
		const ties: string[] = [];
		for (let i = 0; i < 5; i++)
			ties.push(await expense(who, `Tie ${i}`, at(15), { createdAt: same }));
		await expense(who, "Filler old", at(10));
		const old = await expense(who, "Tie old", at(5));
		order = [...ties.sort().reverse(), old];
	});

	it("Activity pages every match once, in order, and counts them on the first page", async () => {
		const seen: string[] = [];
		let cursor: string | undefined;
		let first = true;
		do {
			const page = await activity(who, "tie", { limit: 2, cursor });
			if (first) {
				expect(page.count).toBe(6);
				first = false;
			} else expect(page.count).toBeNull();
			seen.push(...page.items.map((i) => i.id));
			cursor = page.nextCursor ?? undefined;
		} while (cursor);
		expect(seen).toEqual(order);
	});

	it("v1 search pages every match once, in order", async () => {
		const seen: string[] = [];
		let after: { date: string; id: string } | null = null;
		for (let guard = 0; guard < 10; guard++) {
			const page = await v1(who, "tie", 3, after);
			seen.push(...page.slice(0, 2).map((r) => r.id));
			const last = page[1];
			if (page.length < 3 || !last) break;
			after = { date: last.date.toISOString(), id: last.id };
		}
		expect(seen).toEqual(order);
	});
});

describe("rows that change while a scan runs", () => {
	/** Six "edit" rows, newest first. */
	async function six(who: Who) {
		const ids: string[] = [];
		for (let i = 0; i < 6; i++)
			ids.push(await expense(who, `Edit ${i}`, at(20 - i)));
		return ids;
	}
	const moveBack = (id: string) =>
		adminDb.expense.update({ where: { id }, data: { date: at(1) } });

	it("a row whose date moves back between batches is counted once by Activity", async () => {
		const who = await createTestUser();
		const ids = await six(who);
		// 1: hidden projects, 2: the first batch, 3: the second.
		const { result } = await counted(
			() => activity(who, "edit"),
			async (n) => {
				if (n === 3) await moveBack(ids[0] ?? "");
			},
		);
		expect(result.count).toBe(6);
		expect(new Set(result.items.map((i) => i.id)).size).toBe(6);
		expect(result.items).toHaveLength(6);
	});

	it("and once by v1 search", async () => {
		const who = await createTestUser();
		const ids = await six(who);
		const { result } = await counted(
			() => v1(who, "edit", 50),
			async (n) => {
				if (n === 2) await moveBack(ids[0] ?? "");
			},
		);
		expect(result.map((r) => r.id).sort()).toEqual([...ids].sort());
	});

	it("a row deleted between the scan and the page is left out", async () => {
		const who = await createTestUser();
		const ids = await six(who);
		const dry = await counted(() => activity(who, "edit"));
		const gone = ids[2] ?? "";
		const { result } = await counted(
			() => activity(who, "edit"),
			async (n) => {
				if (n === dry.txs)
					await adminDb.$executeRaw`DELETE FROM expense WHERE id = ${gone}`;
			},
		);
		expect(result.items.map((i) => i.id)).toEqual(
			ids.filter((id) => id !== gone),
		);
		// The scan counted it; the count is one high for this request only.
		expect(result.count).toBe(6);
	});

	it("an epoch that appears mid-request never drops the text filter", async () => {
		const who = await createTestUser();
		const match = await expense(who, "Flip match", at(20));
		for (let i = 0; i < 4; i++) await expense(who, `Other ${i}`, at(19 - i));
		// The plain suite starts this request on the SQL path; the sealed one
		// on the app path, where the flip changes nothing.
		resetEpochForTests();
		try {
			const { result } = await counted(
				() => activity(who, "flip"),
				(n) => {
					if (n === 2) markEpochActive();
				},
			);
			expect(result.items.map((i) => i.id)).toEqual([match]);
			expect(result.count).toBe(1);
		} finally {
			markEpochActive();
		}
	});

	it("a key added since the ring loaded fails the request retryably in a later batch", async ({
		skip,
	}) => {
		skip(!sealedSuite, "needs the sealed suite's master key and sealed rows");
		const who = await createTestUser();
		const last = await thirdBatch(who, (d) => expense(who, "Oldest", d));
		// The same sealed cell, naming key 9, which the loaded ring does not hold.
		const sealed = await storedValue("expense", "title", last);
		if (typeof sealed !== "string" || !sealed.startsWith("\u0001k1:"))
			throw new Error("the title is not sealed");
		const raw = Buffer.from(sealed.slice(4), "base64");
		raw.writeUInt32BE(9, 0);
		await writeCell(
			"expense",
			"title",
			last,
			`\u0001k1:${raw.toString("base64")}`,
		);
		vi.spyOn(console, "error").mockImplementation(() => {});
		const failed = await counted(() =>
			activity(who, "zzz").then(
				() => null,
				(error: unknown) => error,
			),
		);
		expect(textUnavailableProblem(failed.result)).toBe("key_rotated");
		// Hidden projects, then three personal batches (the third failed); the
		// key reload it starts in the background may open one more.
		expect(failed.txs).toBeGreaterThanOrEqual(4);
	});
});
