/**
 * The device figure registry held to the server's, figure by figure, on the
 * same Postgres rows. The device side reads a MemoryStore built from the raw
 * rows (src/test/engine-store.ts); the server side reads the real registry
 * through a user transaction. For every device figure id the two readings and
 * the currencies that kept a figure out must be equal, for several profiles:
 * home currencies ARS, USD and JPY, a stored zone that is an alias, missing or
 * unsupported (the server falls back to DEFAULT_TIME_ZONE), a fiscal month
 * that starts on the 15th or the 28th, rows 23:30 local on the last day of
 * the month, a hidden project, and a currency with no rate at all.
 *
 * The clock is the fake system Date only, as the critic round asked: the
 * device registry reads `new Date()` per pass, like the server's figures.
 * Owed to you and You owe are shared money, so the device store holds the
 * server's own reading (owedOnce) in its owed row, as GET /sync/shares hands
 * it to a device.
 */
import { randomUUID } from "node:crypto";
import {
	FigureError,
	FigurePass,
	readFiguresIn,
} from "@retrospend/domain/figures/registry";
import { shiftMonthStart } from "@retrospend/domain/insights";
import { fiscalMonthLabel } from "@retrospend/domain/insights-compute";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createExpense } from "~/server/services/expense-create.mutation";
import { forUser } from "~/server/services/preview";
import { resolveTimeZone } from "~/server/services/user-time-zone";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
// The root app does not depend on the engine package; it is imported by path.
import {
	createDevicePreviewRunner,
	DEVICE_FIGURE_IDS,
	deviceFigures,
	EXPENSE_CREATE_MUTATION,
	serverOnlyReason,
} from "../../../packages/engine/src/index";
import {
	type Ledger,
	P13_PROFILES as PROFILES,
	seedLedger,
	seedRates,
} from "../../test/device-ledger";
import { engineStoreOf } from "../../test/engine-store";
import {
	deviceReadFrom,
	expectSame,
	type Read,
	SCOPELESS_IDS,
	serverRead,
} from "../../test/parity/compare";
import { figures } from "./registry";

const NOW = new Date("2026-10-15T15:00:00Z");
const BA = "America/Argentina/Buenos_Aires";
const D = (v: string) => new Prisma.Decimal(v);

const ledgers = new Map<string, Ledger>();
const previousDefaultZone = process.env.DEFAULT_TIME_ZONE;
/** A category of another user: no figure of this user may read it. */
let bobCategory = "";

beforeAll(async () => {
	// Auckland is a different local day than Buenos Aires at NOW.
	process.env.DEFAULT_TIME_ZONE = "Pacific/Auckland";
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	await seedRates();
	for (const [name, profile] of Object.entries(PROFILES))
		ledgers.set(name, await seedLedger(profile, NOW));
	const { user: bob } = await createTestUser();
	bobCategory = (
		await fixtureDb.category.create({
			data: { name: "Bob's", color: "orange", userId: bob.id },
		})
	).id;
});

afterAll(() => {
	vi.useRealTimers();
	if (previousDefaultZone === undefined) delete process.env.DEFAULT_TIME_ZONE;
	else process.env.DEFAULT_TIME_ZONE = previousDefaultZone;
});

/** The device side over the raw rows of one user (engineStoreOf). */
async function deviceRead(
	userId: string,
	ids: readonly string[],
	narrowing: Record<string, string> = {},
): Promise<Read> {
	return deviceReadFrom(await engineStoreOf(userId), userId, ids, narrowing);
}

describe("the device registry against the server", () => {
	for (const [name, profile] of Object.entries(PROFILES))
		describe(name, () => {
			const ledger = () => ledgers.get(name) as Ledger;

			it("reads every figure as the server does", async () => {
				const { userId } = ledger();
				const ids = [...SCOPELESS_IDS, "accounts.balance"];
				const server = await serverRead(userId, ids);
				expectSame(await deviceRead(userId, ids), server, ids);
				// Not trivially equal because both are null or empty.
				expect(server.readings.get("spent")?.length).toBeGreaterThan(0);
				expect(
					server.readings.get("recurring.cost.out.month"),
				).not.toBeUndefined();
				if (profile.withMissingRate) {
					expect(server.readings.get("glance.spent")).toBeNull();
					expect(server.missing.get("glance.spent")).toEqual(["XQZ"]);
					expect(server.readings.get("netWorth")).toBeNull();
					// The XQZ share keeps the insights totals out, on both sides.
					expect(server.readings.get("insights.spent")).toBeNull();
					expect(server.missing.get("insights.spent")).toEqual(["XQZ"]);
					expect(server.readings.get("insights.ytdUsd")).toBeNull();
				} else {
					expect(server.readings.get("glance.spent")).not.toBeNull();
					expect(server.readings.get("insights.spent")).not.toBeNull();
					expect(server.readings.get("insights.ytd")).not.toBeNull();
					expect(server.readings.get("insights.income")).not.toBeNull();
				}
			});

			// This month, last month, a month a year back (the year boundary) and
			// an empty one ahead, by label; categories of the ledger (an INCOME one
			// that never counts), another user's, and one that does not exist.
			it("reads insights month and category variants as the server does", async () => {
				const { userId } = ledger();
				const zone = resolveTimeZone(profile.timeZone);
				const thisMonth = fiscalMonthLabel(
					{ zone, startDay: profile.startDay },
					NOW,
				);
				const months = [
					thisMonth,
					shiftMonthStart(`${thisMonth}-01`, -1).slice(0, 7),
					"2025-12",
					"2027-03",
				];
				const own = await fixtureDb.category.findMany({ where: { userId } });
				const categories = [
					...own.map((c) => c.id),
					bobCategory,
					"no-such-category",
				];
				const variants: [string, string, string][] = [
					...months.map((m): [string, string, string] => [
						"insights.byMonth",
						"month",
						m,
					]),
					...categories.flatMap((c) =>
						[
							"insights.byCategory",
							"insights.ytdByCategory",
							"insights.ytdByCategoryUsd",
						].map((id): [string, string, string] => [id, "categoryId", c]),
					),
				];
				for (const [id, key, value] of variants)
					expectSame(
						await deviceRead(userId, [id], { [key]: value }),
						await serverRead(userId, [id], { [key]: value }),
						[id],
					);
			});

			it("reads each template and each account as the server does", async () => {
				const { userId, templateIds, accountIds } = ledger();
				const server = async (id: string, key: string, value: string) =>
					serverRead(userId, [id], { [key]: value });
				const device = async (id: string, key: string, value: string) =>
					deviceRead(userId, [id], { [key]: value });
				for (const t of [...templateIds, "no-such-template"])
					expectSame(
						await device("recurring.amount", "recurringId", t),
						await server("recurring.amount", "recurringId", t),
						["recurring.amount"],
					);
				for (const a of [...accountIds, "no-such-account"])
					expectSame(
						await device("accounts.balance", "accountId", a),
						await server("accounts.balance", "accountId", a),
						["accounts.balance"],
					);
			});

			it("previews expense.create as the server does", async () => {
				const { userId } = ledger();
				const input = {
					id: randomUUID(),
					title: "Books",
					amount: "100",
					currency: "USD",
					date: new Date(NOW.getTime() - 60 * 60 * 1000),
				};
				const store = await engineStoreOf(userId);
				const device = await createDevicePreviewRunner({
					store,
					figures: deviceFigures(),
					actor: { userId },
				}).preview(EXPENSE_CREATE_MUTATION, input);
				const server = await forUser(userId).preview(createExpense, input);
				expect(device.changes).toEqual(server.changes);
				expect(device.unchanged).toEqual(server.unchanged);
				expect(device.unavailable).toEqual(server.unavailable);
				expect(device.approx).toEqual(server.approx);
			});
		});
});

describe("the device registry's shape", () => {
	it("registers a subset of the server's ids with the same scope", () => {
		const server = new Set(figures.ids);
		const device = deviceFigures();
		for (const id of device.ids) {
			expect(server.has(id), `${id} is a server figure`).toBe(true);
			expect(device.get(id).scope, `${id} scope`).toEqual(
				figures.get(id).scope,
			);
			expect(device.get(id).inEveryPreview, `${id} inEveryPreview`).toBeFalsy();
		}
		expect([...device.ids].sort()).toEqual([...DEVICE_FIGURE_IDS].sort());
	});

	it("names a reason for every server figure the device lacks", () => {
		for (const id of figures.ids)
			if (!DEVICE_FIGURE_IDS.includes(id))
				expect(serverOnlyReason(id), `${id} needs a reason`).toBeDefined();
	});

	it("touches what the server's expense.create touches", () => {
		expect(EXPENSE_CREATE_MUTATION.touches).toEqual(createExpense.touches);
		expect(EXPENSE_CREATE_MUTATION.id).toBe(createExpense.id);
	});

	// An owed row that names missing currencies makes net worth read
	// unavailable with those names, as an unavailable owed figure does on the server.
	it("reads net worth unavailable when the owed row names missing currencies", async () => {
		const { userId } = ledgers.get(
			"ARS home, alias zone, official default",
		) as Ledger;
		const store = await engineStoreOf(userId);
		await store.transaction((tx) =>
			tx.put("owed", { id: "owed", missingRates: ["BRL"] }),
		);
		const registry = deviceFigures();
		const pass = new FigurePass();
		const readings = await readFiguresIn(
			store,
			[registry.get("netWorth")],
			{ userId },
			pass,
		);
		expect(readings.get("netWorth")).toBeNull();
		expect(pass.missingRates("netWorth")).toEqual(["BRL"]);
	});
});

describe("by hand: a share with no captured rate", () => {
	// Ana, ARS home in Buenos Aires, October at blue 1,500 (official 1,000
	// loses): ARS 1,000 booked as entered; USD 10 worth USD 10; a JPY 1,500
	// share with no captured rate, priced from the table's JPY 150 on its own
	// day. Spent: ARS 1,000.00, JPY 1,500, USD 10.00, per original currency.
	// Glance.spent in ARS: 1,000 + 10 x 1,500 (15,000) + 1,500 / 150 x 1,500
	// (15,000) = 31,000.00. The server's old default left that share unpriced
	// on a device, so glance would have read unavailable there.
	it("reads the same hand-derived numbers on both sides", async () => {
		const { user } = await createTestUser();
		const { user: bob } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { homeCurrency: "ARS", timeZone: BA },
		});
		const row = (
			amount: string,
			currency: string,
			usd: string,
			booked: boolean,
		) =>
			fixtureDb.expense.create({
				data: {
					id: randomUUID(),
					userId: user.id,
					title: "row",
					amount: D(amount),
					currency,
					date: new Date("2026-10-05T15:00:00Z"),
					amountInUSD: D(usd),
					exchangeRate: D("1500"),
					pricingSource: "MANUAL",
					...(booked
						? {
								homeCurrency: "ARS",
								homeAmount: D(amount),
								homeRate: D("1"),
								rateType: "blue",
							}
						: {}),
				},
			});
		await row("1000", "ARS", "0.67", true);
		await row("10", "USD", "10", false);
		await adminDb.sharedTransaction.create({
			data: {
				description: "dinner",
				amount: D("1500"),
				currency: "JPY",
				date: new Date("2026-10-08T15:00:00Z"),
				paidByType: "user",
				paidById: bob.id,
				createdByType: "user",
				createdById: bob.id,
				splitParticipants: {
					create: {
						participantType: "user",
						participantId: user.id,
						shareAmount: D("1500"),
						verificationStatus: "ACCEPTED",
					},
				},
			},
		});
		const ids = ["spent", "glance.spent"];
		const server = await serverRead(user.id, ids);
		const device = await deviceRead(user.id, ids);
		const spent = [
			{ minor: 100_000, currency: "ARS" },
			{ minor: 1_500, currency: "JPY" },
			{ minor: 1_000, currency: "USD" },
		];
		const glance = [{ minor: 3_100_000, currency: "ARS" }];
		for (const side of [server, device]) {
			expect(side.readings.get("spent")).toEqual(spent);
			expect(side.readings.get("glance.spent")).toEqual(glance);
		}
	});
});

/** A user, with the home currency and zone of the test, and a Food category. */
async function insightsUser(home: string, timeZone: string) {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: home, timeZone, fiscalMonthStartDay: 1 },
	});
	const food = (
		await fixtureDb.category.create({
			data: { name: "Food", color: "blue", userId: user.id },
		})
	).id;
	return { userId: user.id, food };
}

function insightsRow(
	userId: string,
	r: {
		at: string;
		amount: string;
		currency: string;
		usd: string;
		categoryId?: string;
		booked?: boolean;
	},
) {
	return fixtureDb.expense.create({
		data: {
			id: randomUUID(),
			userId,
			title: "row",
			amount: D(r.amount),
			currency: r.currency,
			date: new Date(r.at),
			amountInUSD: D(r.usd),
			exchangeRate: D("1500"),
			pricingSource: "MANUAL",
			categoryId: r.categoryId ?? null,
			...(r.booked
				? {
						homeCurrency: r.currency,
						homeAmount: D(r.amount),
						homeRate: D("1"),
						rateType: "blue",
					}
				: {}),
		},
	});
}

describe("by hand: insights with categories", () => {
	// Ana, ARS home in Buenos Aires, at 2026-10-15 (ARS blue 1,400 from Sep 15,
	// 1,500 from Oct 5; official 1,000 loses). Food: ARS 1,000 booked as
	// entered (usd 0.67) and USD 10 on Oct 5; USD 10 on Sep 20, also Food. A JPY
	// 1,500 share of Bob's, no captured rate: JPY 150 -> USD 10.
	//   spent (October at 1,500): 1,000 + 15,000 + 15,000 = 31,000.00
	//   byCategory Food: 1,000 + 15,000 = 16,000.00
	//   spentPrevious (September, end before Oct 5: blue 1,400): 14,000.00
	//   ytd (the span runs past now: 1,500): 31,000 + 15,000 (Sep row) = 46,000.00
	//   ytdByCategory Food: 1,000 + 15,000 + 15,000 = 31,000.00
	//   ytdByCategoryUsd Food: 0.67 + 10 + 10 = 20.67
	it("reads the same hand-derived numbers on both sides, categories above 0", async () => {
		const ana = await insightsUser("ARS", BA);
		const { user: bob } = await createTestUser();
		await insightsRow(ana.userId, {
			at: "2026-10-05T15:00:00Z",
			amount: "1000",
			currency: "ARS",
			usd: "0.67",
			categoryId: ana.food,
			booked: true,
		});
		await insightsRow(ana.userId, {
			at: "2026-10-05T15:00:00Z",
			amount: "10",
			currency: "USD",
			usd: "10",
			categoryId: ana.food,
		});
		await insightsRow(ana.userId, {
			at: "2026-09-20T15:00:00Z",
			amount: "10",
			currency: "USD",
			usd: "10",
			categoryId: ana.food,
		});
		await adminDb.sharedTransaction.create({
			data: {
				description: "dinner",
				amount: D("1500"),
				currency: "JPY",
				date: new Date("2026-10-08T15:00:00Z"),
				paidByType: "user",
				paidById: bob.id,
				createdByType: "user",
				createdById: bob.id,
				splitParticipants: {
					create: {
						participantType: "user",
						participantId: ana.userId,
						shareAmount: D("1500"),
						verificationStatus: "ACCEPTED",
					},
				},
			},
		});
		const ars = (minor: number) => [{ minor, currency: "ARS" }];
		const food = { categoryId: ana.food };
		const expected: [string, Record<string, string>, unknown][] = [
			["insights.spent", {}, ars(3_100_000)],
			["insights.byCategory", food, ars(1_600_000)],
			["insights.spentPrevious", {}, ars(1_400_000)],
			["insights.byMonth", { month: "2026-09" }, ars(1_400_000)],
			["insights.ytd", {}, ars(4_600_000)],
			["insights.ytdByCategory", food, ars(3_100_000)],
			["insights.ytdByCategoryUsd", food, [{ minor: 2_067, currency: "USD" }]],
			// Ana's own Food is not Bob's: his category reads 0.
			["insights.byCategory", { categoryId: bobCategory }, ars(0)],
		];
		for (const [id, narrowing, want] of expected) {
			const server = await serverRead(ana.userId, [id], narrowing);
			const device = await deviceRead(ana.userId, [id], narrowing);
			expect(server.readings.get(id), `${id} server`).toEqual(want);
			expect(device.readings.get(id), `${id} device`).toEqual(want);
		}
	});
});

describe("insights months a figure cannot name", () => {
	// "2026-13" has a month above 12 and still parses (as January 2027); "2026-1"
	// does not parse. Both sides use the one parser, so the readings are equal and
	// the failure is the same error. Month validation is a separate change.
	it("reads '2026-13' alike and fails '2026-1' alike", async () => {
		const { userId } = ledgers.get(
			"ARS home, alias zone, official default",
		) as Ledger;
		const id = "insights.byMonth";
		const narrowing = { month: "2026-13" };
		expectSame(
			await deviceRead(userId, [id], narrowing),
			await serverRead(userId, [id], narrowing),
			[id],
		);
		const failure = async (read: () => Promise<unknown>) => {
			try {
				await read();
			} catch (error) {
				return error;
			}
			throw new Error("the read did not throw");
		};
		const bad = { month: "2026-1" };
		const server = await failure(() => serverRead(userId, [id], bad));
		const device = await failure(() => deviceRead(userId, [id], bad));
		expect(server).toBeInstanceOf(FigureError);
		expect(device).toBeInstanceOf(FigureError);
		expect((device as Error).message).toBe((server as Error).message);
		expect(((device as Error).cause as Error).message).toBe(
			((server as Error).cause as Error).message,
		);
	});
});

describe("insights at the year boundary", () => {
	// The clock is 2027-01-01T03:30Z: 00:30 on January 1 in Buenos Aires, 22:30
	// on December 31 in New York. The same three rows for both users: USD 10
	// (Food) at 03:10Z, ARS 400 (usd 0.29) at 02:50Z, USD 10 at 2026-01-01T03:20Z.
	// ARS blue is 1,500 from Oct 5, 2026, and 1,400 from Sep 15, 2026, which is
	// also the nearest rate after a span that ended in January 2026.
	//
	// Buenos Aires, home ARS: today is Jan 1, 2027, so this period is January
	// and the one before it December. 03:10Z is January 1 there, 02:50Z is
	// December 31 (in neither year-to-date span), and 2026-01-01T03:20Z is
	// January 1, 2026 (last year's one-day span).
	//   spent 10 x 1,500 = 15,000.00; spentPrevious 400.00; byCategory Food 15,000.00
	//   ytd 15,000.00; ytdUsd 10.00; ytdLastYear 10 x 1,400 = 14,000.00; ytdLastYearUsd 10.00
	//   byMonth 2026-12 400.00; 2027-01 15,000.00
	//
	// New York, home USD: still December 31, 2026. This period is December,
	// holding 03:10Z (22:10) and 02:50Z (21:50); the year is 2026, so both count
	// and 2026-01-01T03:20Z is Dec 31, 2025 there, last year.
	//   spent 10 + 0.29 = 10.29; spentPrevious (November) 0.00; byCategory Food 10.00
	//   ytd 10.29; ytdUsd 10.29; ytdLastYear 10.00; ytdLastYearUsd 10.00; byMonth 2026-12 10.29
	const BOUNDARY = new Date("2027-01-01T03:30:00Z");
	let ba: { userId: string; food: string };
	let ny: { userId: string; food: string };

	beforeAll(async () => {
		ba = await insightsUser("ARS", BA);
		ny = await insightsUser("USD", "America/New_York");
		for (const u of [ba, ny]) {
			await insightsRow(u.userId, {
				at: "2027-01-01T03:10:00Z",
				amount: "10",
				currency: "USD",
				usd: "10",
				categoryId: u.food,
			});
			await insightsRow(u.userId, {
				at: "2027-01-01T02:50:00Z",
				amount: "400",
				currency: "ARS",
				usd: "0.29",
			});
			await insightsRow(u.userId, {
				at: "2026-01-01T03:20:00Z",
				amount: "10",
				currency: "USD",
				usd: "10",
			});
		}
		vi.setSystemTime(BOUNDARY);
	});
	afterAll(() => {
		vi.setSystemTime(NOW);
	});

	const insightsIds = SCOPELESS_IDS.filter((id) => id.startsWith("insights."));

	it("every insights figure reads as the server does, for every ledger and both new users", async () => {
		const users = [
			ba.userId,
			ny.userId,
			...[...ledgers.values()].map((l) => l.userId),
		];
		for (const userId of users)
			expectSame(
				await deviceRead(userId, insightsIds),
				await serverRead(userId, insightsIds),
				insightsIds,
			);
	});

	const money = (currency: string) => (minor: number) => [{ minor, currency }];
	const cases = (
		who: () => { userId: string; food: string },
		unit: (minor: number) => { minor: number; currency: string }[],
		usd: (minor: number) => { minor: number; currency: string }[],
		want: {
			spent: number;
			previous: number;
			food: number;
			ytd: number;
			ytdUsd: number;
			lastYear: number;
			lastYearUsd: number;
			december: number;
			january?: number;
		},
	) => {
		const read = async (side: "server" | "device", id: string, n = {}) => {
			const { userId } = who();
			const result =
				side === "server"
					? await serverRead(userId, [id], n)
					: await deviceRead(userId, [id], n);
			return result.readings.get(id);
		};
		const rows: [string, Record<string, string>, unknown][] = [
			["insights.spent", {}, unit(want.spent)],
			["insights.spentPrevious", {}, unit(want.previous)],
			["insights.byCategory", { categoryId: who().food }, unit(want.food)],
			["insights.ytd", {}, unit(want.ytd)],
			["insights.ytdUsd", {}, usd(want.ytdUsd)],
			["insights.ytdLastYear", {}, unit(want.lastYear)],
			["insights.ytdLastYearUsd", {}, usd(want.lastYearUsd)],
			["insights.byMonth", { month: "2026-12" }, unit(want.december)],
			...(want.january === undefined
				? []
				: [
						["insights.byMonth", { month: "2027-01" }, unit(want.january)] as [
							string,
							Record<string, string>,
							unknown,
						],
					]),
		];
		return async () => {
			for (const [id, narrowing, expected] of rows) {
				expect(await read("server", id, narrowing), `${id} server`).toEqual(
					expected,
				);
				expect(await read("device", id, narrowing), `${id} device`).toEqual(
					expected,
				);
			}
		};
	};

	it("Buenos Aires is already in the new year", async () => {
		await cases(() => ba, money("ARS"), money("USD"), {
			spent: 1_500_000,
			previous: 40_000,
			food: 1_500_000,
			ytd: 1_500_000,
			ytdUsd: 1_000,
			lastYear: 1_400_000,
			lastYearUsd: 1_000,
			december: 40_000,
			january: 1_500_000,
		})();
	});

	it("New York is still on December 31", async () => {
		await cases(() => ny, money("USD"), money("USD"), {
			spent: 1_029,
			previous: 0,
			food: 1_000,
			ytd: 1_029,
			ytdUsd: 1_029,
			lastYear: 1_000,
			lastYearUsd: 1_000,
			december: 1_029,
		})();
	});
});
