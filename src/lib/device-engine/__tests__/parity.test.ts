import type { DeviceRead } from "@retrospend/engine/device";
import { expense } from "@retrospend/engine/device-fake";
import { describe, expect, it } from "vitest";
import {
	countsOf,
	GLANCE_PARITY_IDS,
	idsToCheck,
	NOT_PLANNED_YET,
} from "../parity";
import { ARS, code, fakeClock, NOW, setup, urlOf } from "./harness";

const BA = "America/Argentina/Buenos_Aires";
const IDS = ["glance.spent", "glance.spentLastToDate", "glance.spentLast"];
const requestsTo = (
	fetched: ReturnType<typeof setup>["fetched"],
	part: string,
) => fetched.mock.calls.filter(([input]) => urlOf(input).includes(part));

describe("which figures are checked", () => {
	const read = (ids: string[], budgetReady: boolean): DeviceRead => ({
		homeCurrency: "ARS",
		budgetReady,
		budget: null,
		readings: new Map(ids.map((id) => [id, ARS(1)])),
	});

	it("is the glance figures the engine has, never owed or the dollar rate", () => {
		expect(GLANCE_PARITY_IDS).toEqual([
			"glance.spent",
			"glance.spentLastToDate",
			"glance.spentLast",
			"netWorth",
			"glance.moneyIn",
		]);
		for (const id of GLANCE_PARITY_IDS)
			expect(id).not.toMatch(/owed|rate\.dollarToday/);
	});

	it("takes Not planned yet only while the budget block is readable", () => {
		const ids = [...IDS, NOT_PLANNED_YET];
		expect(idsToCheck(read(ids, true), GLANCE_PARITY_IDS)).toEqual([
			...IDS,
			NOT_PLANNED_YET,
		]);
		expect(idsToCheck(read(ids, false), GLANCE_PARITY_IDS)).toEqual(IDS);
		// A reading the engine does not have is not asked of the server.
		expect(idsToCheck(read(["glance.spent"], true), GLANCE_PARITY_IDS)).toEqual(
			["glance.spent"],
		);
	});
});

// Rows of the engine's own tests, "now" 2026-10-15 15:00 UTC, Buenos Aires:
// spent 1,000.00 (100,000 minor), spent last month by this day 2,000.00
// (200,000), spent last month 2,500.00 (250,000).
describe("parity against the server", () => {
	fakeClock(NOW);
	const server = (spentLast: number) => () => ({
		"glance.spent": ARS(100_000),
		"glance.spentLastToDate": ARS(200_000),
		"glance.spentLast": ARS(spentLast),
	});

	it("compares the figures the device read with the server's lines, in the stored zone", async () => {
		const { client, fetched } = setup({
			serverFigures: server(250_000),
			deps: { parityIds: IDS, browserZone: () => "Asia/Tokyo" },
		});
		await client.start("u1");
		await client.pull();
		const report = await client.parity();
		expect(report).toEqual({
			state: "checked",
			ids: IDS,
			mismatchedIds: [],
			counts: IDS.map((id) => ({ id, device: 1, server: 1 })),
			generation: 1,
			storedZone: BA,
			browserZone: "Asia/Tokyo",
			zoneDiffers: true,
		});
		const [figures] = requestsTo(fetched, "/figures");
		expect(urlOf(figures?.[0])).toContain(`ids=${IDS.join(",")}`);
	});

	it("pulls once more on a difference, compares again, and records ids and counts only", async () => {
		const { client, fetched, warn } = setup({
			serverFigures: server(260_000),
			deps: { parityIds: IDS, browserZone: () => BA },
		});
		await client.start("u1");
		await client.pull();
		const settingsBefore = requestsTo(fetched, "/sync/settings").length;
		const report = await client.parity();
		expect(report.state).toBe("checked");
		expect(report.mismatchedIds).toEqual(["glance.spentLast"]);
		// Counts of lines, one per currency, on each side (the amounts are not kept).
		expect(report.counts).toEqual(
			IDS.map((id) => ({ id, device: 1, server: 1 })),
		);
		expect(report.zoneDiffers).toBe(false);
		// Exactly one delta pull (a settings request opens each), two looks at the server.
		expect(requestsTo(fetched, "/sync/settings").length - settingsBefore).toBe(
			1,
		);
		expect(requestsTo(fetched, "/figures").length).toBe(1);
		expect(report.generation).toBe(2);
		// Nothing logged or reported holds an amount, the server's or the device's.
		const text = JSON.stringify([report, warn.mock.calls]);
		expect(text).not.toMatch(/260000|250000|200000|100000/);
		expect(warn).toHaveBeenCalledWith(
			"figures differ from the server",
			expect.stringContaining("glance.spentLast"),
		);
	});

	it("checks nothing until the device has pulled: a failed pull is skipped, with no request to the server's figures", async () => {
		const { client, answer, fetched } = setup({
			serverFigures: server(250_000),
			deps: { parityIds: IDS },
		});
		await client.start("u1");
		answer.status = 500;
		const report = await client.parity();
		expect(report.state).toBe("skipped");
		expect(report.ids).toEqual([]);
		expect(requestsTo(fetched, "/figures")).toHaveLength(0);
	});

	it("refuses to check before it is started", async () => {
		const { client } = setup();
		expect(await code(client.parity())).toBe("not_started");
	});
});

// Stored zone UTC, browser in Buenos Aires (UTC-3), ARS, "now" 2026-11-10
// 12:00 UTC. One expense of 1,000 ARS at 2026-11-01 01:00 UTC: November 1 in
// UTC, October 31 (22:00) in Buenos Aires. In UTC: spent this month 1,000.00
// = 100,000 minor and last month 0. The server's figures route reads in the
// stored zone too, whatever the browser's, so the two agree, and the report
// notes that the browser's zone is another (the tRPC Home reads in it).
describe("a month boundary with the stored zone apart from the browser's", () => {
	const NOV = Date.parse("2026-11-10T12:00:00.000Z");
	fakeClock(NOV);
	const boundaryRow = () => expense("b1", "1000", "2026-11-01T01:00:00.000Z");

	it("agrees with the server and notes the browser's zone", async () => {
		const { client, fetched } = setup({
			now: NOV,
			zone: "UTC",
			rows: [boundaryRow()],
			serverFigures: (zone) =>
				zone === "UTC"
					? { "glance.spent": ARS(100_000), "glance.spentLast": ARS(0) }
					: { "glance.spent": ARS(0), "glance.spentLast": ARS(100_000) },
			deps: {
				parityIds: ["glance.spent", "glance.spentLast"],
				browserZone: () => BA,
			},
		});
		await client.start("u1");
		await client.pull();
		const read = await client.read(["glance.spent", "glance.spentLast"]);
		expect(read?.readings.get("glance.spent")).toEqual(ARS(100_000));
		expect(read?.readings.get("glance.spentLast")).toEqual(ARS(0));
		const report = await client.parity();
		expect(report.state).toBe("checked");
		expect(report.mismatchedIds).toEqual([]);
		expect(report.storedZone).toBe("UTC");
		expect(report.browserZone).toBe(BA);
		expect(report.zoneDiffers).toBe(true);
		// The request names no zone: the server does not read one.
		const [figures] = requestsTo(fetched, "/figures");
		expect(typeof figures?.[0]).toBe("string");
	});
});

describe("line counts", () => {
	fakeClock(NOW);
	const read = (counts: Record<string, number>) =>
		({
			homeCurrency: "ARS",
			budgetReady: false,
			budget: null,
			readings: new Map(
				Object.entries(counts).map(([id, n]) => [id, Array(n).fill(ARS(1)[0])]),
			),
		}) as unknown as DeviceRead;

	it("counts both sides of a difference from the last comparison, and an unknown side as null", () => {
		const counts = countsOf(
			["a", "b", "c"],
			// What the device read before the engine's second pull.
			read({ a: 1, b: 1, c: 1 }),
			[
				{ id: "b", device: [1, 2], server: [1] },
				{ id: "c", device: [1], server: null },
			],
		);
		expect(counts).toEqual([
			{ id: "a", device: 1, server: 1 },
			{ id: "b", device: 2, server: 1 },
			{ id: "c", device: 1, server: null },
		]);
	});

	it("reports a server with more lines than the device, and a missing server figure", async () => {
		const { client } = setup({
			serverFigures: () => ({
				"glance.spent": ARS(100_000),
				"glance.spentLastToDate": null,
				"glance.spentLast": [
					{ minor: 250_000, currency: "ARS" },
					{ minor: 1, currency: "USD" },
				],
			}),
			deps: { parityIds: IDS },
		});
		await client.start("u1");
		await client.pull();
		const report = await client.parity();
		expect(report.mismatchedIds).toEqual([
			"glance.spentLastToDate",
			"glance.spentLast",
		]);
		expect(report.counts).toEqual([
			{ id: "glance.spent", device: 1, server: 1 },
			{ id: "glance.spentLastToDate", device: 1, server: null },
			{ id: "glance.spentLast", device: 1, server: 2 },
		]);
	});
});

describe("a check that does not finish", () => {
	fakeClock(NOW);

	it("is reported as failed, not skipped, and the device is not taken as checked", async () => {
		const { client, hooks } = setup({
			serverFigures: () => ({
				"glance.spent": ARS(100_000),
				"glance.spentLastToDate": ARS(200_000),
				"glance.spentLast": ARS(250_000),
			}),
			deps: { parityIds: IDS },
		});
		await client.start("u1");
		await client.pull();
		hooks.status = async (url) => (url.includes("/figures") ? 500 : undefined);
		const report = await client.parity();
		expect(report.state).toBe("failed");
		expect(report.ids).toEqual(IDS);
		expect(report.mismatchedIds).toEqual([]);
		// A run after the server answers again checks properly.
		hooks.status = undefined;
		expect((await client.parity()).state).toBe("checked");
	});
});
