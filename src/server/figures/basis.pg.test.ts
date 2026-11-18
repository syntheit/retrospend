/**
 * readFiguresWithBasis on real Postgres: the cursor in `asOf` bounds every row
 * the read saw (also while an older transaction is open, where the cut would
 * not), and the figures, settings and rate stamp come from one snapshot even
 * when a write commits in the middle of the read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { decodeCursor } from "~/server/services/api-v1/cursor";
import { readDailyRates } from "~/server/services/api-v1/rate-sync";
import { readChanges, syncCursorSchema } from "~/server/services/sync/changes";
import {
	stampOf,
	stampsOf,
	until,
} from "~/server/services/sync/sync-test-support";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { readFiguresWithBasis } from "./read";
import { type FigureDefinition, figures } from "./registry";

const expense = (userId: string, amount: string) =>
	fixtureDb.expense.create({
		data: {
			userId,
			title: "Row",
			currency: "USD",
			date: new Date(),
			amount,
			amountInUSD: amount,
			exchangeRate: "1",
			pricingSource: "MANUAL",
		},
		select: { id: true },
	});

const cursorOf = (token: string) => {
	const parsed = decodeCursor(token, syncCursorSchema);
	if (!parsed) throw new Error("no cursor");
	return { epoch: parsed.e, txid: BigInt(parsed.t) };
};

/** Resolves when `release()` is called, and lets the test wait for `opened()`. */
function latch() {
	let release: () => void = () => undefined;
	let opened: () => void = () => undefined;
	return {
		gate: new Promise<void>((r) => {
			release = r;
		}),
		hasOpened: new Promise<void>((r) => {
			opened = r;
		}),
		release: () => release(),
		opened: () => opened(),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("readFiguresWithBasis: asOf", () => {
	it("is at or past a write committed before the read, in this epoch", async () => {
		const { user } = await createTestUser();
		const { id } = await expense(user.id, "12.34");
		const { readings, basis } = await readFiguresWithBasis(user.id, ["spent"]);
		expect(readings.get("spent")).toEqual([{ minor: 1234, currency: "USD" }]);
		const stamp = await stampOf(user.id, "expense", id);
		if (!basis || !stamp) throw new Error("no basis or stamp");
		const seen = cursorOf(basis.asOf);
		expect(seen.txid >= BigInt(stamp.txid)).toBe(true);
		const [state] = await adminDb.$queryRaw<
			{ epoch: string }[]
		>`SELECT "epoch" FROM "sync_state" WHERE "id" = 1`;
		expect(seen.epoch).toBe(state?.epoch);
	});

	it("covers a row committed while an older transaction is open, and a device pulled to it holds that row", async () => {
		const mine = await createTestUser();
		const theirs = await createTestUser();
		const older = latch();
		let openTxid = 0n;
		const open = userTransaction(adminDb, theirs.user.id, async (tx) => {
			const xids = await tx.$queryRaw<
				{ xid: string }[]
			>`SELECT pg_current_xact_id()::text AS "xid"`;
			openTxid = BigInt(xids[0]?.xid ?? "0");
			await tx.expense.create({
				data: {
					userId: theirs.user.id,
					title: "Open",
					currency: "USD",
					date: new Date(),
					amount: "1",
					amountInUSD: "1",
					exchangeRate: "1",
					pricingSource: "MANUAL",
				},
			});
			older.opened();
			await older.gate;
		});
		await older.hasOpened;
		const { id } = await expense(mine.user.id, "7.5");
		const stamp = await stampOf(mine.user.id, "expense", id);
		const pull = () =>
			readChanges(adminDb, mine.user.id, "expense", { limit: 500 });
		// The cut waits for the open writer: a device cannot hold the row yet.
		expect((await pull()).items).toEqual([]);

		try {
			const { readings, basis } = await readFiguresWithBasis(mine.user.id, [
				"spent",
			]);
			expect(readings.get("spent")).toEqual([{ minor: 750, currency: "USD" }]);
			if (!basis || !stamp) throw new Error("no basis or stamp");
			const seen = cursorOf(basis.asOf);
			expect(seen.txid >= BigInt(stamp.txid)).toBe(true);
			// The writer open during the read is past the cut and within asOf.
			const cut = cursorOf(basis.cut);
			expect(cut.epoch).toBe(seen.epoch);
			expect(cut.txid < openTxid).toBe(true);
			expect(openTxid <= seen.txid).toBe(true);

			older.release();
			await open;
			const page = await until(
				pull,
				(p) => cursorOf(p.cursor).txid >= seen.txid,
				45_000,
			);
			expect(cursorOf(page.cursor).txid >= seen.txid).toBe(true);
			expect(page.items.map((r) => r.id)).toContain(id);
			// What the writer committed after the read is past the cut.
			const late = await stampsOf(theirs.user.id, "expense");
			expect(late).toHaveLength(1);
			expect(BigInt(late[0]?.txid ?? "0") > cut.txid).toBe(true);
		} finally {
			// A failed assertion must not leave the older writer open.
			older.release();
		}
	}, 90_000);
});

describe("readFiguresWithBasis: one snapshot", () => {
	it("keeps the settings and rate stamp of the figures when a write commits mid-read", async () => {
		const { user } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: {
				homeCurrency: "EUR",
				fiscalMonthStartDay: 15,
				timeZone: "Asia/Tokyo",
			},
		});
		await adminDb.exchangeRate.upsert({
			where: {
				date_currency_type: {
					date: new Date("2026-01-01T00:00:00.000Z"),
					currency: "ARS",
					type: "blue",
				},
			},
			create: {
				date: new Date("2026-01-01T00:00:00.000Z"),
				currency: "ARS",
				type: "blue",
				rate: "1545",
				updatedAt: new Date("2026-01-01T00:00:00.000Z"),
			},
			update: {},
		});
		const before = (await readDailyRates(adminDb)).body.asOf;

		// A figure that reads the settings first, then waits for the writes.
		const started = latch();
		const settingsFigure: FigureDefinition = {
			id: "test.settings",
			scope: [],
			compute: async (db, scope) => {
				const row = await db.user.findUniqueOrThrow({
					where: { id: scope.userId },
					select: { homeCurrency: true, fiscalMonthStartDay: true },
				});
				started.opened();
				await started.gate;
				return {
					minor: row.fiscalMonthStartDay,
					currency: row.homeCurrency,
				};
			},
		};
		const original = figures.get.bind(figures);
		vi.spyOn(figures, "get").mockImplementation((id) =>
			id === settingsFigure.id ? settingsFigure : original(id),
		);

		const reading = readFiguresWithBasis(user.id, [settingsFigure.id]);
		await started.hasOpened;
		await adminDb.user.update({
			where: { id: user.id },
			data: {
				homeCurrency: "ARS",
				fiscalMonthStartDay: 20,
				timeZone: "Pacific/Honolulu",
			},
		});
		await adminDb.exchangeRate.create({
			data: {
				date: new Date("2026-02-01T00:00:00.000Z"),
				currency: "BRL",
				type: "official",
				rate: "5",
				updatedAt: new Date("2026-02-01T00:00:00.000Z"),
			},
		});
		started.release();
		const { readings, basis } = await reading;

		expect(readings.get(settingsFigure.id)).toEqual([
			{ minor: 15, currency: "EUR" },
		]);
		expect(basis).toMatchObject({
			home: "EUR",
			startDay: 15,
			timeZone: "Asia/Tokyo",
			ratesAsOf: before,
		});
		const after = await readFiguresWithBasis(user.id, ["spent"]);
		expect(after.basis).toMatchObject({
			home: "ARS",
			startDay: 20,
			timeZone: "Pacific/Honolulu",
		});
		expect(after.basis?.ratesAsOf).not.toBe(before);
	}, 90_000);

	it("takes the cut from the read's own snapshot: a writer that commits mid-read stays past it", async () => {
		const { user } = await createTestUser();
		const writer = latch();
		let writerTxid = 0n;
		const open = userTransaction(adminDb, user.id, async (tx) => {
			const xids = await tx.$queryRaw<
				{ xid: string }[]
			>`SELECT pg_current_xact_id()::text AS "xid"`;
			writerTxid = BigInt(xids[0]?.xid ?? "0");
			writer.opened();
			await writer.gate;
		});
		await writer.hasOpened;

		const midRead = latch();
		const holdFigure: FigureDefinition = {
			id: "test.hold",
			scope: [],
			compute: async () => {
				midRead.opened();
				await midRead.gate;
				return { minor: 1, currency: "USD" };
			},
		};
		const original = figures.get.bind(figures);
		vi.spyOn(figures, "get").mockImplementation((id) =>
			id === holdFigure.id ? holdFigure : original(id),
		);
		const reading = readFiguresWithBasis(user.id, [holdFigure.id]);
		try {
			await midRead.hasOpened;
			// The writer ends while the read is open; a cut read now would pass it.
			writer.release();
			await open;
		} finally {
			midRead.release();
		}
		const { basis } = await reading;
		if (!basis) throw new Error("no basis");
		expect(cursorOf(basis.cut).txid < writerTxid).toBe(true);
		expect(cursorOf(basis.cut).txid < cursorOf(basis.asOf).txid).toBe(true);
	}, 60_000);

	it("names the rate stamp GET /rates/daily returns, and the instant it read at", async () => {
		const { user } = await createTestUser();
		const from = Date.now();
		const { basis } = await readFiguresWithBasis(user.id, ["spent"]);
		const to = Date.now();
		expect(basis?.ratesAsOf).toBe((await readDailyRates(adminDb)).body.asOf);
		const at = Date.parse(basis?.at ?? "");
		expect(at >= from && at <= to).toBe(true);
	});

	it("gives no basis for a user the database cannot see, rather than guessing one", async () => {
		const { readings, basis } = await readFiguresWithBasis("no-such-user", []);
		expect(readings.size).toBe(0);
		expect(basis).toBeNull();
	});
});
