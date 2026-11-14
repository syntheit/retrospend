import { beforeAll, describe, expect, it } from "vitest";
import { benchJson, benchRows, type Primitives, runCryptoBench } from "../src";
import { createWebPrimitives } from "../src/web";

let p: Primitives;
beforeAll(async () => {
	p = await createWebPrimitives();
});

const tiny = { memoryKiB: 8 * 1024, passes: 1 };

describe("runCryptoBench", () => {
	it("times each step with the injected clock and shapes the report", async () => {
		// A clock that moves 5 ms per reading: every timed span reads 5 ms.
		let t = 0;
		const steps: string[] = [];
		const report = await runCryptoBench(p, {
			now: () => (t += 5),
			runs: 3,
			argon2Sets: [tiny],
			records: 4,
			onStep: (label) => steps.push(label),
		});
		expect(report.argon2).toEqual([
			{ ...tiny, runs: 3, medianMs: 5, maxMs: 5 },
		]);
		expect(report.records).toEqual({
			records: 4,
			sealMs: 5,
			openMs: 5,
			openPerRecordMs: 1.25,
		});
		expect(steps).toEqual(["Argon2id 8 MiB, 1 passes", "Open 4 records"]);
	});

	it("renders rows and one line of JSON", async () => {
		let t = 0;
		const report = await runCryptoBench(p, {
			now: () => (t += 5),
			runs: 1,
			argon2Sets: [tiny],
			records: 2,
		});
		expect(benchRows(report, " (main thread)").map((row) => row.label)).toEqual(
			[
				"Argon2id 8 MiB, 1 passes",
				"Open 2 records (main thread)",
				"Seal 2 records (main thread)",
			],
		);
		const line = benchJson({ device: "test" }, report);
		expect(line).not.toContain("\n");
		expect(JSON.parse(line)).toMatchObject({
			device: "test",
			argon2: [{ memoryMiB: 8, passes: 1, runs: 1, medianMs: 5, maxMs: 5 }],
			records: { count: 2, openMs: 5, openPerRecordUs: 2500 },
		});
	});
});
