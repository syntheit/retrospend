/**
 * The completeness gate (S3 milestone 6): every tRPC procedure either has the
 * v1 routes that do its job or a written reason it has none. Zero
 * unexplained rows. Reasons live in scripts/api-v1-completeness.map.ts.
 */
import { describe, expect, it } from "vitest";
import {
	buildReport,
	formatReport,
	isClean,
} from "../../../../../scripts/api-v1-completeness";
import { COMPLETENESS } from "../../../../../scripts/api-v1-completeness.map";

const report = buildReport();

describe("API v1 completeness", () => {
	it("explains every tRPC procedure", () => {
		expect(report.unexplained).toEqual([]);
	});

	it("keeps no entry for a procedure that is gone", () => {
		expect(report.stale).toEqual([]);
	});

	it("names only routes the contract has", () => {
		expect(report.missingRoutes).toEqual([]);
	});

	it("gives every reason words", () => {
		expect(report.blankReasons).toEqual([]);
	});

	it("is clean as a whole, with a report that lists every procedure", () => {
		expect(isClean(report)).toBe(true);
		expect(report.rows.length).toBeGreaterThan(400);
		expect(formatReport(report)).toContain("procedures:");
	});

	it("writes no em dash in a reason", () => {
		for (const [key, entry] of Object.entries(COMPLETENESS))
			if ("why" in entry) expect(entry.why, key).not.toContain("—");
	});

	it("keeps the platform rows to the ones the platform agent builds", () => {
		const platform = report.rows
			.filter((r) => r.kind === "g5-platform")
			.map((r) => r.procedure);
		expect(platform).toEqual([
			"deviceSession.disconnect",
			"deviceSession.list",
		]);
	});
});
