import { beforeAll, describe, expect, it } from "vitest";
import {
	benchJson,
	benchRows,
	CryptoError,
	type Primitives,
	runCryptoBench,
} from "../src";
import { createWebPrimitives } from "../src/web";

let p: Primitives;
beforeAll(async () => {
	p = await createWebPrimitives();
});

const tiny = { memoryKiB: 8 * 1024, passes: 1 };
const tinyToo = { memoryKiB: 16 * 1024, passes: 1 };

/**
 * A clock that plays back the given spans: each timed region reads a start
 * and an end, and the end is the start plus the next span.
 */
function scripted(spans: number[]) {
	let t = 0;
	let reads = 0;
	let next = 0;
	return () => {
		if (reads++ % 2 === 0) return t;
		t += spans[next++] as number;
		return t;
	};
}

describe("runCryptoBench", () => {
	it("takes the median of an even run count, and keeps max apart from it", async () => {
		// Argon2 spans 10, 40, 20, 30: median (20 + 30) / 2, max 40. Seal 7, open 3.
		const report = await runCryptoBench(p, {
			now: scripted([10, 40, 20, 30, 7, 3]),
			runs: 4,
			argon2Sets: [tiny],
			records: 4,
		});
		expect(report.argon2).toEqual([
			{ ...tiny, runs: 4, medianMs: 25, maxMs: 40 },
		]);
		expect(report.records).toEqual({
			records: 4,
			sealMs: 7,
			openMs: 3,
			openPerRecordMs: 0.75,
		});
	});

	it("takes the middle run of an odd count", async () => {
		const report = await runCryptoBench(p, {
			now: scripted([5, 9, 1, 2, 2]),
			runs: 3,
			argon2Sets: [tiny],
			records: 1,
		});
		expect(report.argon2).toEqual([
			{ ...tiny, runs: 3, medianMs: 5, maxMs: 9 },
		]);
	});

	it("reports each step label before it runs", async () => {
		const steps: string[] = [];
		await runCryptoBench(p, {
			now: scripted([1, 1, 1]),
			runs: 1,
			argon2Sets: [tiny],
			records: 2,
			onStep: (label) => steps.push(label),
		});
		expect(steps).toEqual(["Argon2id 8 MiB, 1 passes", "Open 2 records"]);
	});

	it("keeps finished results when one Argon2 set throws", async () => {
		const failing: Primitives = {
			...p,
			argon2id: (password, salt, params) => {
				if (params.memoryKiB === tinyToo.memoryKiB) {
					throw new CryptoError("invalid_input");
				}
				return p.argon2id(password, salt, params);
			},
		};
		// The throw leaves a start read unpaired, so use a clock that ticks 5 ms
		// per read rather than a scripted one.
		let t = 0;
		const report = await runCryptoBench(failing, {
			now: () => (t += 5),
			runs: 1,
			argon2Sets: [tiny, tinyToo],
			records: 2,
		});
		expect(report.argon2[0]).toMatchObject({ medianMs: 5 });
		expect(report.argon2[1]).toEqual({ ...tinyToo, failed: "CryptoError" });
		expect(report.records).toMatchObject({ records: 2, sealMs: 5, openMs: 5 });
		expect(benchRows(report).map((r) => r.value)).toEqual([
			"5 ms median, 5 ms max",
			"failed (CryptoError)",
			"5 ms, 2500 us each",
			"5 ms",
		]);
		expect(JSON.parse(benchJson({}, report)).argon2[1]).toEqual({
			memoryMiB: 16,
			passes: 1,
			failed: "CryptoError",
		});
	});

	it("keeps the Argon2 results when the records step throws", async () => {
		const failing: Primitives = {
			...p,
			aeadEncrypt: () => {
				throw new CryptoError("invalid_input");
			},
		};
		const report = await runCryptoBench(failing, {
			now: scripted([6]),
			runs: 1,
			argon2Sets: [tiny],
			records: 2,
		});
		expect(report.argon2).toHaveLength(1);
		expect(report.records).toEqual({ records: 2, failed: "CryptoError" });
		expect(benchRows(report, " (main thread)")).toEqual([
			{ label: "Argon2id 8 MiB, 1 passes", value: "6 ms median, 6 ms max" },
			{
				label: "Open 2 records (main thread)",
				value: "failed (CryptoError)",
			},
		]);
		expect(JSON.parse(benchJson({ device: "test" }, report))).toMatchObject({
			device: "test",
			records: { count: 2, failed: "CryptoError" },
		});
	});

	it("renders rows and one line of JSON", async () => {
		const report = await runCryptoBench(p, {
			now: scripted([12, 7, 3]),
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
		expect(JSON.parse(line)).toEqual({
			device: "test",
			argon2: [{ memoryMiB: 8, passes: 1, runs: 1, medianMs: 12, maxMs: 12 }],
			records: { count: 2, sealMs: 7, openMs: 3, openPerRecordUs: 1500 },
		});
	});
});
