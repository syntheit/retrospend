import { describe, expect, it } from "vitest";
import {
	historyRowsOf,
	lastCommitPerDay,
	parseRateKey,
} from "../rate-history-backfill";

describe("parseRateKey", () => {
	it("reads a bare code as official and a suffix as the type", () => {
		expect(parseRateKey("EUR")).toEqual({ currency: "EUR", type: "official" });
		expect(parseRateKey("ARS_BLUE")).toEqual({ currency: "ARS", type: "blue" });
		expect(parseRateKey("ARS_CARD_TOURIST")).toEqual({
			currency: "ARS",
			type: "card_tourist",
		});
	});
});

describe("historyRowsOf", () => {
	const file = {
		updatedAt: "2026-10-31T14:17:32Z",
		rates: { EUR: 0.86, ARS_BLUE: 1555, XYZ_: 1, ZERO: 0, NAN: Number.NaN },
		cryptoRates: { BTC: 67000, DOGEX: 1, ETH: -1 },
	};

	it("keys every row by the file's UTC day, coins at type crypto", () => {
		expect(historyRowsOf(file, new Set(["BTC", "ETH"]))).toEqual([
			{ day: "2026-10-31", currency: "EUR", type: "official", rate: 0.86 },
			{ day: "2026-10-31", currency: "ARS", type: "blue", rate: 1555 },
			{ day: "2026-10-31", currency: "BTC", type: "crypto", rate: 67000 },
		]);
	});

	it("gives nothing for a file with no readable date", () => {
		expect(
			historyRowsOf({ updatedAt: "soon", rates: { EUR: 1 } }, new Set()),
		).toEqual([]);
	});
});

describe("lastCommitPerDay", () => {
	it("keeps the day's last commit, newest day first", () => {
		const commits = [
			{ sha: "a", date: "2026-10-30T01:00:00Z" },
			{ sha: "b", date: "2026-10-30T23:00:00Z" },
			{ sha: "c", date: "2026-10-31T05:00:00Z" },
			{ sha: "d", date: "2026-10-29T12:00:00Z" },
			{ sha: "x", date: "nope" },
		];
		expect(lastCommitPerDay(commits).map((c) => c.sha)).toEqual([
			"c",
			"b",
			"d",
		]);
	});
});
