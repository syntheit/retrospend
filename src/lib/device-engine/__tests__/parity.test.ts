import type { DeviceRead } from "@retrospend/engine/device";
import { expense } from "@retrospend/engine/device-fake";
import { describe, expect, it } from "vitest";
import { GLANCE_PARITY_IDS, idsToCheck, NOT_PLANNED_YET } from "../parity";
import { ARS, code, fakeClock, NOW, setup } from "./harness";

const BA = "America/Argentina/Buenos_Aires";
const IDS = ["glance.spent", "glance.spentLastToDate", "glance.spentLast"];
const requestsTo = (
	fetched: ReturnType<typeof setup>["fetched"],
	part: string,
) =>
	fetched.mock.calls.filter(([input]) =>
		(typeof input === "string" ? input : (input as Request).url).includes(part),
	);

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
			// The browser's cookie says Tokyo; the stored zone is Buenos Aires.
			browserZone: "Asia/Tokyo",
			deps: { parityIds: IDS, browserZone: () => "Asia/Tokyo" },
		});
		await client.start("u1");
		await client.pull();
		const report = await client.parity();
		expect(report).toEqual({
			state: "checked",
			ids: IDS,
			mismatchedIds: [],
			generation: 1,
			storedZone: BA,
			browserZone: "Asia/Tokyo",
			zoneDiffers: true,
		});
		const [figures] = requestsTo(fetched, "/figures");
		const request = figures?.[0] as Request;
		expect(new URL(request.url).searchParams.get("ids")).toBe(IDS.join(","));
		expect(request.headers.get("x-timezone")).toBe(BA);
		// Only the figures route is told a zone: the sync requests go out untouched.
		const sync = requestsTo(fetched, "/sync/");
		expect(sync.length).toBeGreaterThan(0);
		expect(sync.every(([input]) => typeof input === "string")).toBe(true);
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
// = 100,000 minor and last month 0. In Buenos Aires the same row would be
// last month's, so a server reading in the browser's zone would answer 0 and
// 100,000. The header makes the server read in the stored zone, so they agree.
describe("a month boundary with the stored zone apart from the browser's", () => {
	const NOV = Date.parse("2026-11-10T12:00:00.000Z");
	fakeClock(NOV);
	const boundaryRow = () => expense("b1", "1000", "2026-11-01T01:00:00.000Z");

	it("agrees with the server only because the request names the stored zone", async () => {
		const { client } = setup({
			now: NOV,
			zone: "UTC",
			rows: [boundaryRow()],
			browserZone: BA,
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
		expect(report.mismatchedIds).toEqual([]);
		expect(report.storedZone).toBe("UTC");
		expect(report.browserZone).toBe(BA);
		expect(report.zoneDiffers).toBe(true);
	});
});
