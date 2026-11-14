/**
 * The budget block of the shares snapshot on Postgres (E2EE P13b PR 1c). The
 * numbers are the 1a vector (budget-block-test-support.ts has the derivation:
 * Bob's USD 30 held is 45,000.00 = 4,500,000 minor, the USD 10 with no booked
 * value is 15,000.00 = 1,500,000 minor, frozen).
 *
 * Owed to you for Bob's USD 30 is priced at the rates of the moment of the
 * read, at the stored-rate preference for ARS (blue, then official: quotes.ts):
 * 30 x 1,500 = ARS 45,000.00 = 4,500,000 minor, the same as the block holds
 * the debt at its booking rate.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFigures } from "~/server/figures/read";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { seedUser, setupInput } from "../envelope/__tests__/pg-fixture";
import { getMonth } from "../envelope/read.service";
import { setupEnvelopeBook } from "../envelope/setup.mutation";
import type { BudgetRead } from "./budget-block";
import {
	BUDGET_IDS,
	NOW,
	row,
	startClock,
	stopClock,
	VECTOR_FIGURES,
	vector,
	ZONE,
} from "./budget-block-test-support";
import { readShareSnapshot } from "./snapshots";

// What a test does around the pull: after each tx1, in place of the budget
// load, and a record of what each tx1 did.
const hooks = vi.hoisted(() => ({
	afterFreeze: null as null | (() => Promise<void>),
	blockFails: null as null | ((tx: unknown) => Promise<void>),
	freezes: [] as string[],
}));

vi.mock("./budget-block", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./budget-block")>();
	return {
		...actual,
		runFreeze: async (...args: Parameters<typeof actual.runFreeze>) => {
			const result = await actual.runFreeze(...args);
			hooks.freezes.push(`${args[2]?.force ? "forced " : ""}${result}`);
			await hooks.afterFreeze?.();
			return result;
		},
		readBudgetBlock: async (
			...args: Parameters<typeof actual.readBudgetBlock>
		) => {
			await hooks.blockFails?.(args[0]);
			return actual.readBudgetBlock(...args);
		},
	};
});

beforeAll(startClock);
afterAll(stopClock);

const pull = (userId: string) =>
	readShareSnapshot(adminDb, userId, { budget: true });

function blockOf(read: BudgetRead | undefined) {
	if (read?.kind !== "block") throw new Error(`no block: ${read?.kind}`);
	return read.block;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pulls until a freeze is skipped. A stamp becomes visible to the signal only
 * once every older transaction on the database server has ended (the oldest
 * open transaction bounds it), which another test file's connection can delay
 * by a moment: so "nothing new since the last run" is waited for, not assumed.
 */
async function untilQuiet(userId: string) {
	for (let i = 0; i < 100; i++) {
		hooks.freezes.length = 0;
		await pull(userId);
		if (hooks.freezes[0] === "skipped") return;
		await sleep(50);
	}
	throw new Error("the freeze never went quiet");
}

/** Pulls until a freeze runs: a new stamp reaches the signal the same way. */
async function untilRan(userId: string) {
	for (let i = 0; i < 100; i++) {
		hooks.freezes.length = 0;
		await pull(userId);
		if (hooks.freezes[0] === "ran") return;
		await sleep(50);
	}
	throw new Error("the freeze never ran");
}

const reset = () => {
	hooks.afterFreeze = null;
	hooks.blockFails = null;
	hooks.freezes.length = 0;
};

describe("the vector through the block", () => {
	it("carries the splits, the frozen value, the key and the owed totals as derived", async () => {
		reset();
		const v = await vector();
		const snapshot = await pull(v.userId);
		const block = blockOf(snapshot.budget);
		expect(block.bookId).toBe(v.bookId);
		// Currency, zone, start (Nov 5 midnight in Buenos Aires), and the one period.
		expect(block.valuationKey).toBe(
			JSON.stringify([
				"ARS",
				ZONE,
				"2026-11-05T03:00:00.000Z",
				[[202611, 5, "blue"]],
			]),
		);
		// Only the USD 10 with no booked value of the user's own: 10 x 1,500.
		expect(block.frozen).toEqual([
			{
				key: `${v.unbooked}|USD|10|10|2026-11-08|blue`,
				minor: 1_500_000,
				approximate: false,
			},
		]);
		// Your USD 30 of the split: 30 x 1,500 = 45,000.00, spending, in Dining.
		expect(block.splits.shares).toEqual([
			{
				id: v.myShare,
				month: 202611,
				date: "2026-11-10",
				minor: -4_500_000,
				source: "SHARE",
				categoryId: v.dining,
				envelopeId: null,
				pending: false,
			},
		]);
		// Bob owes USD 30, held at 45,000.00; nothing else is out.
		expect(block.splits.balances).toEqual([
			{
				counterparty: "p1",
				currency: "USD",
				native: 3000,
				basis: 4_500_000,
				oldestOpen: "2026-11-10",
			},
		]);
		expect(block.splits.events).toMatchObject([
			{ kind: "FRONT", id: "e1", counterparty: "p1", value: 4_500_000 },
		]);
		expect(block.splits.effects).toMatchObject([
			{ term: "FRONTED", eventId: "e1", counterparty: "p1", minor: 4_500_000 },
		]);
		expect(block.splits.missingRates).toEqual([]);
		expect(block.splits.checkpointMissingRates).toEqual([]);
		// Owed to you, from the same snapshot: USD 30 at blue 1,500.
		expect(snapshot.owed).toMatchObject({ owedToYou: 4_500_000, youOwe: 0 });
		const text = JSON.stringify(block);
		expect(text).not.toContain(v.bobShadow);
		expect(text).not.toContain(v.bobsShare);
	});

	it("leaves the server's own figures at the vector after a pull", async () => {
		reset();
		const v = await vector();
		await pull(v.userId);
		expect(
			Object.fromEntries(
				await readFigures(v.userId, BUDGET_IDS, {
					envelopeId: v.envelopes.Dining,
				}),
			),
		).toEqual(VECTOR_FIGURES);
	});

	it("gives the same web figures with and without a prior pull, same clock and data", async () => {
		reset();
		const pulled = await vector();
		const plain = await vector();
		await pull(pulled.userId);
		const read = async (v: typeof pulled) =>
			Object.fromEntries(
				await readFigures(v.userId, BUDGET_IDS, {
					envelopeId: v.envelopes.Dining,
				}),
			);
		const [a, b] = [await read(pulled), await read(plain)];
		expect(a).toEqual(b);
		expect(a).toEqual(VECTOR_FIGURES);
	});

	it("freezes nothing before the first pull and the values it keeps after", async () => {
		reset();
		const v = await vector();
		const count = () =>
			adminDb.budgetRowValue.count({ where: { bookId: v.bookId } });
		expect(await count()).toBe(0);
		await pull(v.userId);
		// The USD 10, your USD 30 and Bob's USD 30 front: three kept values,
		// of which the block sends only the user's own expense.
		expect(await count()).toBe(3);
	});

	it("keeps the values it sent when the rate is rewritten, and prices a later row at the new one", async () => {
		reset();
		const v = await vector();
		const first = blockOf((await pull(v.userId)).budget);
		await adminDb.exchangeRate.updateMany({
			where: { currency: "ARS", type: "blue" },
			data: { rate: "1600" },
		});
		try {
			const second = blockOf((await pull(v.userId)).budget);
			expect(second.frozen).toEqual(first.frozen);
			expect(second.splits.shares).toEqual(first.splits.shares);
			// A new USD 10 row after the rewrite: 10 x 1,600 = 16,000.00.
			const added = await row(v, {
				amount: "10",
				currency: "USD",
				at: "2026-11-11T15:00:00Z",
			});
			const third = blockOf((await pull(v.userId)).budget);
			expect(
				third.frozen.map((f) => [f.key.split("|")[0], f.minor]).sort(),
			).toEqual(
				[
					[v.unbooked, 1_500_000],
					[added.id, 1_600_000],
				].sort(),
			);
		} finally {
			await adminDb.exchangeRate.updateMany({
				where: { currency: "ARS", type: "blue" },
				data: { rate: "1500" },
			});
		}
	});

	it("sends nothing of one user's to another", async () => {
		reset();
		const [a, b] = [await vector(), await vector()];
		const keys = async (v: typeof a) =>
			blockOf((await pull(v.userId)).budget).frozen.map((f) => f.key);
		const [ka, kb] = [await keys(a), await keys(b)];
		expect(ka).toEqual([`${a.unbooked}|USD|10|10|2026-11-08|blue`]);
		expect(kb).toEqual([`${b.unbooked}|USD|10|10|2026-11-08|blue`]);
	});
});

describe("when there is no block to make", () => {
	it("does not run the freeze or add a budget without the flag", async () => {
		reset();
		const v = await vector();
		const snapshot = await readShareSnapshot(adminDb, v.userId);
		expect(snapshot.budget).toBeUndefined();
		expect(snapshot.shares).toHaveLength(1);
		expect(hooks.freezes).toEqual([]);
		expect(
			await adminDb.budgetRowValue.count({ where: { bookId: v.bookId } }),
		).toBe(0);
	});

	it("is none for Just track", async () => {
		reset();
		const { user } = await createTestUser();
		const snapshot = await pull(user.id);
		expect(snapshot.budget).toEqual({ kind: "none" });
		expect(snapshot.owed).toMatchObject({ owedToYou: 0, youOwe: 0 });
		expect(hooks.freezes).toEqual(["skipped"]);
	});

	it("is none for a book someone else is a member of", async () => {
		reset();
		const v = await vector();
		const other = (await createTestUser()).user.id;
		await adminDb.budgetMember.create({
			data: { bookId: v.bookId, userId: other, role: "EDITOR" },
		});
		expect((await pull(v.userId)).budget).toEqual({ kind: "none" });
		// Nothing was frozen for it either.
		expect(hooks.freezes).toEqual(["skipped"]);
		expect(
			await adminDb.budgetRowValue.count({ where: { bookId: v.bookId } }),
		).toBe(0);
	});

	it("is none for a book with no default envelope", async () => {
		reset();
		const v = await vector();
		await adminDb.budgetBook.update({
			where: { id: v.bookId },
			data: { defaultEnvelopeId: null },
		});
		expect((await pull(v.userId)).budget).toEqual({ kind: "none" });
	});
});

describe("the freeze before the snapshot", () => {
	it("is skipped when no stamp arrived since the last run, and runs again after one", async () => {
		reset();
		const v = await vector();
		expect((await pull(v.userId)).budget?.kind).toBe("block");
		expect(hooks.freezes[0]).toBe("ran");
		await untilQuiet(v.userId);
		await row(v, { amount: "5", at: "2026-11-12T15:00:00Z" });
		await untilRan(v.userId);
		expect(hooks.freezes).toEqual(["ran"]);
	});

	it("still finds a value only a skipped run would have frozen, and freezes it on the retry", async () => {
		reset();
		const v = await vector();
		await untilQuiet(v.userId);
		// Lose a kept value without a stamp: the next freeze is skipped, the
		// block finds it unfrozen, and the retry puts it back.
		await adminDb.budgetRowValue.deleteMany({ where: { bookId: v.bookId } });
		hooks.freezes.length = 0;
		const block = blockOf((await pull(v.userId)).budget);
		expect(hooks.freezes).toEqual(["skipped", "forced ran"]);
		expect(block.frozen).toHaveLength(1);
	});

	it("freezes a row that came in between the freeze and the snapshot, by running it once more", async () => {
		reset();
		const v = await vector();
		let late: string | null = null;
		hooks.afterFreeze = async () => {
			hooks.afterFreeze = null;
			late = (
				await row(v, {
					amount: "10",
					currency: "USD",
					at: "2026-11-12T15:00:00Z",
				})
			).id;
		};
		const snapshot = await pull(v.userId);
		const block = blockOf(snapshot.budget);
		expect(hooks.freezes).toEqual(["ran", "forced ran"]);
		// USD 10 x 1,500 = 15,000.00 for each of the two unbooked rows.
		expect(
			block.frozen.map((f) => [f.key.split("|")[0], f.minor]).sort(),
		).toEqual(
			[
				[v.unbooked, 1_500_000],
				[late, 1_500_000],
			].sort(),
		);
	});

	it("answers the budget as unavailable when a row keeps coming in, and still returns the shares and owed", async () => {
		reset();
		const v = await vector();
		let n = 0;
		hooks.afterFreeze = async () => {
			n += 1;
			await row(v, {
				amount: "10",
				currency: "USD",
				at: `2026-11-${String(10 + n).padStart(2, "0")}T15:00:00Z`,
			});
		};
		const snapshot = await pull(v.userId);
		expect(snapshot.budget).toEqual({ kind: "unavailable" });
		expect(snapshot.shares).toHaveLength(1);
		expect(snapshot.owed).toMatchObject({ owedToYou: 4_500_000 });
		expect(hooks.freezes).toEqual(["ran", "forced ran"]);
	});
});

describe("one snapshot", () => {
	it("shows a settle-up made after the freeze in the owed totals and the block together", async () => {
		reset();
		const v = await vector();
		const before = await pull(v.userId);
		expect(before.owed).toMatchObject({ owedToYou: 4_500_000 });
		expect(blockOf(before.budget).splits.balances[0]).toMatchObject({
			native: 3000,
			basis: 4_500_000,
		});
		// Bob pays his USD 30 after the freeze: settled at the booking rate,
		// 30 x 1,500 = 45,000.00 released from the held amount.
		hooks.afterFreeze = async () => {
			hooks.afterFreeze = null;
			await adminDb.settlement.create({
				data: {
					fromParticipantType: "shadow",
					fromParticipantId: v.bobShadow,
					toParticipantType: "user",
					toParticipantId: v.userId,
					amount: new Prisma.Decimal(30),
					currency: "USD",
					status: "FINALIZED",
					confirmedByPayer: true,
					confirmedByPayee: true,
					settledAt: new Date("2026-11-14T14:00:00Z"),
				},
			});
		};
		const after = await pull(v.userId);
		expect(after.owed).toMatchObject({ owedToYou: 0, youOwe: 0 });
		const splits = blockOf(after.budget).splits;
		expect(splits.balances).toMatchObject([
			{ counterparty: "p1", native: 0, basis: 0 },
		]);
		expect(splits.effects.map((e) => [e.term, e.minor])).toEqual([
			["FRONTED", 4_500_000],
			["RETURNED", 4_500_000],
		]);
	});

	it("keeps asOf below a writer that is still open", async () => {
		reset();
		const v = await vector();
		let release: () => void = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let writer = "";
		let started: () => void = () => {};
		const open = new Promise<void>((resolve) => {
			started = resolve;
		});
		// pg_current_xact_id assigns the writer its txid, as a first write would.
		const writing = adminDb.$transaction(async (tx) => {
			const rows = await tx.$queryRaw<{ id: string }[]>`
				SELECT pg_current_xact_id()::text AS id`;
			writer = rows[0]?.id ?? "";
			started();
			await held;
		});
		await open;
		try {
			const block = blockOf((await pull(v.userId)).budget);
			const cursor = JSON.parse(
				Buffer.from(block.asOf, "base64url").toString("utf8"),
			) as { e: string; t: string; s: string };
			expect(BigInt(cursor.t)).toBeLessThan(BigInt(writer));
		} finally {
			release();
			await writing;
		}
	});

	it("returns the shares and owed totals when the budget load throws", async () => {
		reset();
		const v = await vector();
		hooks.blockFails = async () => {
			throw new Error("boom");
		};
		const snapshot = await pull(v.userId);
		expect(snapshot.budget).toEqual({ kind: "unavailable" });
		expect(snapshot.shares).toHaveLength(1);
		expect(snapshot.owed).toMatchObject({ owedToYou: 4_500_000, youOwe: 0 });
	});

	it("returns them too when the budget load fails inside the database", async () => {
		reset();
		const v = await vector();
		// A failed statement aborts the transaction; the savepoint keeps the rest.
		hooks.blockFails = async (tx) => {
			await (tx as typeof adminDb).$executeRaw`SELECT 1 / 0`;
		};
		const snapshot = await pull(v.userId);
		expect(snapshot.budget).toEqual({ kind: "unavailable" });
		expect(snapshot.owed).toMatchObject({ owedToYou: 4_500_000 });
		// The next pull is whole again.
		hooks.blockFails = null;
		expect((await pull(v.userId)).budget?.kind).toBe("block");
	});

	it("reads without writing: a write in the snapshot is refused", async () => {
		reset();
		const v = await vector();
		hooks.blockFails = async (tx) => {
			await (tx as typeof adminDb).budgetRowValue.deleteMany({
				where: { bookId: v.bookId },
			});
		};
		const snapshot = await pull(v.userId);
		// The refused write is the block's failure, not the snapshot's.
		expect(snapshot.budget).toEqual({ kind: "unavailable" });
		expect(
			await adminDb.budgetRowValue.count({ where: { bookId: v.bookId } }),
		).toBe(3);
	});
});

describe("a rate missing when a month closed", () => {
	/**
	 * An MDL book from August with no MDL rate at all. A USD 10 row on Sep 5
	 * has none to value it: left out and listed, and the checkpoint written
	 * when Aug to Oct close (Nov 4) keeps that. An MDL rate then appears dated
	 * Nov 3: a later date than the row's month, so no close is revised (only
	 * a rate for an earlier date marks a month dirty) and the checkpoint still
	 * answers. The server keeps the row out; the block says so, with its
	 * currency, so a device that would value it at the nearest rate leaves it
	 * out too.
	 */
	it("stays out of the figures and is listed in the block with its currency", async () => {
		reset();
		const s = await seedUser();
		await adminDb.user.update({
			where: { id: s.user.id },
			data: { homeCurrency: "MDL" },
		});
		await adminDb.exchangeRate.deleteMany({
			where: { currency: "MDL", type: "official" },
		});
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			startingMoneyMinor: 0,
			timeZone: "UTC",
		});
		const book = await adminDb.budgetBook.findFirstOrThrow({
			where: { createdById: s.user.id },
		});
		await adminDb.budgetBook.update({
			where: { id: book.id },
			data: { startMonth: 202608, startDate: new Date("2026-08-01T00:00:00Z") },
		});
		await adminDb.bookPeriod.updateMany({
			where: { bookId: book.id },
			data: { fromMonth: 202608 },
		});
		const sep = await fixtureDb.expense.create({
			data: {
				userId: s.user.id,
				title: "Row",
				amount: new Prisma.Decimal(10),
				currency: "USD",
				date: new Date("2026-09-05T15:00:00Z"),
				categoryId: s.dining,
				amountInUSD: new Prisma.Decimal(10),
				exchangeRate: new Prisma.Decimal(1),
				pricingSource: "MANUAL",
			},
		});
		try {
			vi.setSystemTime(new Date("2026-11-04T15:00:00Z"));
			// The first read closes August to October with the row missing.
			const month = await getMonth(s.user.id, undefined, new Date());
			expect(month?.incomplete).toBe(true);
			const rate = await adminDb.exchangeRate.create({
				data: {
					date: new Date("2026-11-03T00:00:00Z"),
					currency: "MDL",
					type: "official",
					rate: "41",
				},
			});
			try {
				const snapshot = await pull(s.user.id);
				const splits = blockOf(snapshot.budget).splits;
				expect(splits.checkpointMissingRates).toEqual([
					{
						currency: "MDL",
						rateType: "official",
						date: "2026-09-05",
						rowId: sep.id,
					},
				]);
				// Still unavailable on the server, the figure the device must match.
				expect(
					(await readFigures(s.user.id, ["budget.notPlannedYet"])).get(
						"budget.notPlannedYet",
					),
				).toBeNull();
			} finally {
				await adminDb.exchangeRate.delete({ where: { id: rate.id } });
			}
		} finally {
			vi.setSystemTime(NOW);
		}
	});
});
