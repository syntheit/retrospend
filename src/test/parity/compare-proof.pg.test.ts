/**
 * The compare proof: the device engine's own check (compare.ts, run by
 * createDeviceEngine as the phone and the web worker run it) held against real
 * ledgers, through the v1 sync and figures routes, with the figures on both
 * sides read at the server's own instant.
 *
 * Hand-derived: three small ledgers whose every figure is worked out in
 * proof-ledger.ts (EUR home with ARS rows at the blue rate, ARS home with USD
 * rows, and a home currency with no rate), at 2026-12-01T01:30Z, which is
 * 22:30 on November 30 in the stored zone, Buenos Aires, and already December
 * in UTC. A missing rate reads null on both sides, which is a match, and on
 * one side only, which differs; it is never zero.
 *
 * Breadth: the parity ledger (every table, 400 expenses, a budget book) with an
 * EUR home, in Buenos Aires from the 1st and in Honolulu from the 15th, checked
 * on every screen with every narrowing value at clocks on a month edge and a
 * year edge. Each report must be `checked`, with nothing that differs.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	type CompareReport,
	compareLine,
	MAX_NARROWED_CALLS,
	SCREENS,
	type ScreenName,
} from "../../../packages/engine/src/device/index";
import type { LedgerProfile } from "../device-ledger";
import { deviceReadFrom, INSIGHTS_MONTHS, serverRead } from "./compare";
import { atClock, type Check, checkAt } from "./compare-run";
import { type ParityLedger, SMALL_SIZE, seedParityLedger } from "./ledger";
import {
	ARS_EXPECTED,
	BA,
	dropProofRates,
	EUR_EXPECTED,
	type HandLedgers,
	type ProofRates,
	seedHandLedgers,
	seedProofRates,
} from "./proof-ledger";
import { expectedCounts, newDevice, pullAll } from "./pull";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

/** November 30, 22:30 in Buenos Aires: December in UTC and in Auckland. */
const NOV_EDGE = new Date("2026-12-01T01:30:00Z");
/** December 31, 22:30 in Buenos Aires: a new year in UTC. */
const YEAR_EDGE = new Date("2027-01-01T01:30:00Z");
/** Half a minute before midnight in Buenos Aires. */
const NEAR_MIDNIGHT = new Date("2026-12-01T02:59:30Z");

let rates: ProofRates;
let hand: HandLedgers;
const previousDefaultZone = process.env.DEFAULT_TIME_ZONE;

beforeAll(async () => {
	// Auckland is another local day than Buenos Aires at every clock below.
	process.env.DEFAULT_TIME_ZONE = "Pacific/Auckland";
	rates = await seedProofRates();
	hand = await seedHandLedgers();
}, 300_000);

afterAll(async () => {
	vi.useRealTimers();
	await dropProofRates(rates);
	await adminDb.$disconnect().catch(() => undefined);
	if (previousDefaultZone === undefined) delete process.env.DEFAULT_TIME_ZONE;
	else process.env.DEFAULT_TIME_ZONE = previousDefaultZone;
});

const HOME_FIGURES = [
	"glance.spent",
	"glance.spentLast",
	"glance.spentLastToDate",
	"glance.moneyIn",
];

/** What `userId` reads for `ids` on the server, and on a device that pulled everything, both at `clock`. */
async function readBoth(userId: string, ids: string[], clock: Date) {
	const device = await newDevice(userId);
	await atClock(clock, async () =>
		pullAll(device, await expectedCounts(userId), {
			atClock: (pull) => pull(),
		}),
	);
	return atClock(clock, async () => ({
		server: await serverRead(userId, ids),
		device: await deviceReadFrom(device.store, userId, ids),
	}));
}

const lineText = (report: CompareReport) => compareLine(report);

describe("hand-derived ledgers", () => {
	it("EUR home: the figures are the worked-out ones on both sides", async () => {
		const { server, device } = await readBoth(hand.eur, HOME_FIGURES, NOV_EDGE);
		for (const side of [server, device]) {
			expect(side.readings.get("glance.spent")).toEqual([EUR_EXPECTED.spent]);
			expect(side.readings.get("glance.spentLast")).toEqual([
				EUR_EXPECTED.spentLast,
			]);
			expect(side.readings.get("glance.spentLastToDate")).toEqual([
				EUR_EXPECTED.spentLastToDate,
			]);
			expect(side.readings.get("glance.moneyIn")).toEqual([
				EUR_EXPECTED.moneyIn,
			]);
		}
	});

	it("ARS home: an unbooked USD row is priced at blue, a booked one stays at official", async () => {
		const { server, device } = await readBoth(
			hand.ars,
			["glance.spent"],
			NOV_EDGE,
		);
		expect(server.readings.get("glance.spent")).toEqual([ARS_EXPECTED.spent]);
		expect(device.readings.get("glance.spent")).toEqual([ARS_EXPECTED.spent]);
	});

	it("a home currency with no rate reads null on both sides, never zero", async () => {
		const { server, device } = await readBoth(
			hand.noRate,
			["glance.spent"],
			NOV_EDGE,
		);
		expect(server.readings.get("glance.spent")).toBeNull();
		expect(device.readings.get("glance.spent")).toBeNull();
		expect(server.missing.get("glance.spent")).toEqual(["XQZ"]);
	});

	it("the engine finds nothing that differs on the EUR ledger, in any browser zone", async () => {
		for (const browserZone of [BA, "Asia/Tokyo"]) {
			const { reports } = await checkAt(
				NOV_EDGE,
				hand.eur,
				[{ screen: "home" }, { screen: "settings" }],
				{ browserZone },
			);
			for (const report of reports) {
				expect(report.state, lineText(report)).toBe("checked");
				expect(report.differs, lineText(report)).toEqual([]);
				expect(report.behind).toBe(0);
				expect(report.ratesMoved).toBe(0);
				expect(report.zone).toBe(browserZone === BA ? "same" : "differs");
			}
			const home = reports[0] as CompareReport;
			for (const id of HOME_FIGURES) expect(home.classes[id]).toBe("match");
		}
	});

	it("the engine finds nothing that differs on the ARS ledger, and a missing rate matches", async () => {
		const ars = await checkAt(NOV_EDGE, hand.ars, [{ screen: "settings" }], {
			browserZone: BA,
		});
		expect(ars.reports[0]?.classes["glance.spent"]).toBe("match");
		const none = await checkAt(
			NOV_EDGE,
			hand.noRate,
			[{ screen: "settings" }, { screen: "home" }],
			{ browserZone: BA },
		);
		for (const report of none.reports) {
			expect(report.state, lineText(report)).toBe("checked");
			expect(report.differs).toEqual([]);
			expect(report.classes["glance.spent"]).toBe("match");
		}
	});

	it("a value on one side only differs, and a zero is not a missing rate", async () => {
		// The server says 0 XQZ where the device has no value: never a match.
		const zero = await checkAt(
			NOV_EDGE,
			hand.noRate,
			[{ screen: "settings" }],
			{
				browserZone: BA,
				alter: (answer) => ({
					...answer,
					figures: answer.figures.map((f) =>
						f.id === "glance.spent"
							? { ...f, lines: [{ minor: 0, currency: "XQZ" }] }
							: f,
					),
				}),
			},
		);
		expect(zero.reports[0]?.differs).toEqual(["glance.spent"]);
		// The server has no value where the device holds one.
		const none = await checkAt(NOV_EDGE, hand.eur, [{ screen: "settings" }], {
			browserZone: BA,
			alter: (answer) => ({
				...answer,
				figures: answer.figures.map((f) =>
					f.id === "glance.spent" ? { ...f, lines: null } : f,
				),
			}),
		});
		expect(none.reports[0]?.differs).toEqual(["glance.spent"]);
		expect(none.logs.join("\n")).toContain('"differs":["glance.spent"]');
	});

	it("a wrong rate type in a figure differs", async () => {
		// The EUR total read as if A were revalued at official: 117.71 for A.
		const wrong = await checkAt(NOV_EDGE, hand.eur, [{ screen: "settings" }], {
			browserZone: BA,
			alter: (answer) => ({
				...answer,
				figures: answer.figures.map((f) =>
					f.id === "glance.spent"
						? { ...f, lines: [{ minor: 32_571, currency: "EUR" }] }
						: f,
				),
			}),
		});
		expect(wrong.reports[0]?.differs).toEqual(["glance.spent"]);
	});

	it("stored UTC with the browser in Buenos Aires: the figures read in UTC", async () => {
		// At 01:30Z on December 1 it is December in the stored zone: D (00:30Z) is
		// the only row of the period, 10 USD = 8.00; November is A, B, C and E,
		// 80 + 160 + 40 + 56 = 336.00. The browser's zone changes no figure.
		const { server, device } = await readBoth(
			hand.eurUtc,
			["glance.spent", "glance.spentLast"],
			NOV_EDGE,
		);
		for (const side of [server, device]) {
			expect(side.readings.get("glance.spent")).toEqual([
				{ minor: 800, currency: "EUR" },
			]);
			expect(side.readings.get("glance.spentLast")).toEqual([
				{ minor: 33_600, currency: "EUR" },
			]);
		}
		const { reports } = await checkAt(
			NOV_EDGE,
			hand.eurUtc,
			[{ screen: "home" }],
			{ browserZone: BA },
		);
		expect(reports[0], lineText(reports[0] as CompareReport)).toMatchObject({
			state: "checked",
			differs: [],
			zone: "differs",
		});
	});

	it("a read within a minute of midnight is skipped, never a false difference", async () => {
		const { reports } = await checkAt(
			NEAR_MIDNIGHT,
			hand.eur,
			[{ screen: "home" }],
			{ browserZone: BA },
		);
		expect(reports[0]).toMatchObject({
			state: "skipped",
			skipped: "period_edge",
			differs: [],
		});
	});
});

const PROFILES: Record<string, { profile: LedgerProfile; clocks: Date[] }> = {
	"EUR home, Buenos Aires, month from the 1st": {
		profile: { home: "EUR", timeZone: BA, startDay: 1 },
		clocks: [NOV_EDGE, YEAR_EDGE],
	},
	"EUR home, Honolulu, month from the 15th": {
		profile: { home: "EUR", timeZone: "Pacific/Honolulu", startDay: 15 },
		// 00:30 on January 15 in Honolulu, the first day of its period; and 23:30
		// on December 31 there, which is January 1 in Tokyo.
		clocks: [
			new Date("2027-01-15T10:30:00Z"),
			new Date("2027-01-01T09:30:00Z"),
		],
	},
};

/** The narrowing values each screen renders, from the ledger. */
function valuesOf(ledger: ParityLedger, screen: ScreenName): Check["values"] {
	switch (screen) {
		case "budget":
			return { envelopeId: ledger.envelopeIds };
		case "wealth":
			return { accountId: ledger.accountIds };
		case "recurring":
			return { recurringId: ledger.templateIds };
		case "insights":
			return {
				categoryId: [...ledger.categoryIds, ledger.incomeCategory],
				month: INSIGHTS_MONTHS,
			};
		default:
			return {};
	}
}

const SCREEN_ORDER: ScreenName[] = [
	"home",
	"budget",
	"wealth",
	"recurring",
	"insights",
	"settings",
];

/** The narrowed calls a screen makes for `values`: one per narrowing value of a kind it narrows by. */
function narrowedCalls(screen: ScreenName, values: Check["values"]): number {
	const kinds = new Set(Object.values(SCREENS[screen].narrowed));
	return Object.entries(values ?? {}).reduce(
		(n, [kind, list]) =>
			kinds.has(kind as never) ? n + new Set(list).size : n,
		0,
	);
}

/** Checks of each screen until every narrowing value was held once: the calls come MAX_NARROWED_CALLS at a time. */
function checksFor(ledger: ParityLedger): Check[] {
	return SCREEN_ORDER.flatMap((screen) => {
		const values = valuesOf(ledger, screen);
		const rounds = Math.max(
			1,
			Math.ceil(narrowedCalls(screen, values) / MAX_NARROWED_CALLS),
		);
		return Array.from({ length: rounds }, () => ({ screen, values }));
	});
}

describe("real ledgers: every screen, every narrowing value", () => {
	for (const [name, { profile, clocks }] of Object.entries(PROFILES))
		describe(name, () => {
			let ledger: ParityLedger;
			beforeAll(async () => {
				ledger = await seedParityLedger({
					seed: name.length,
					size: SMALL_SIZE,
					profile,
					clocks,
				});
			}, 300_000);

			for (const clock of clocks)
				it(`checks clean at ${clock.toISOString()}`, async () => {
					const { reports } = await checkAt(
						clock,
						ledger.userId,
						checksFor(ledger),
						{ browserZone: profile.timeZone ?? BA },
					);
					const held = new Map<ScreenName, Set<string>>();
					for (const report of reports) {
						expect(report.state, lineText(report)).toBe("checked");
						expect(report.differs, lineText(report)).toEqual([]);
						expect(report.behind, lineText(report)).toBe(0);
						expect(report.ratesMoved, lineText(report)).toBe(0);
						expect(report.zone, lineText(report)).toBe("same");
						const keys = held.get(report.screen) ?? new Set<string>();
						for (const key of Object.keys(report.classes)) keys.add(key);
						held.set(report.screen, keys);
					}
					// Every key of every screen was held by some check.
					for (const screen of SCREEN_ORDER)
						expect(held.get(screen)?.size, screen).toBe(
							reports.find((r) => r.screen === screen)?.of,
						);
				});

			it("names a figure the server got wrong by its key", async () => {
				const envelope = ledger.envelopeIds[0] as string;
				const { reports } = await checkAt(
					clocks[0] as Date,
					ledger.userId,
					[{ screen: "budget", values: { envelopeId: [envelope] } }],
					{
						browserZone: profile.timeZone ?? BA,
						// One minor unit more on one envelope's call: the smallest difference.
						alter: (answer, query) =>
							query.envelopeId === envelope
								? {
										...answer,
										figures: answer.figures.map((f) =>
											f.id === "envelope.left"
												? {
														...f,
														lines: f.lines
															? f.lines.map((m) => ({
																	...m,
																	minor: m.minor + 1,
																}))
															: [{ minor: 1, currency: profile.home }],
													}
												: f,
										),
									}
								: answer,
					},
				);
				expect(reports[0]?.differs).toEqual([`envelope.left:${envelope}`]);
			});
		});
});
