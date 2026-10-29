import type { ExportJobDto } from "@retrospend/api-contract";
import {
	ExportFailedError,
	MAX_POLLS,
	mimeOf,
	pollDelay,
	safeFileName,
	waitForExport,
} from "./exportJob";

const job = (patch: Partial<ExportJobDto>): ExportJobDto => ({
	id: "job-1",
	kind: "data",
	format: "zip",
	state: "queued",
	fileName: null,
	sizeBytes: null,
	error: null,
	createdAt: "2026-10-29T12:00:00.000Z",
	completedAt: null,
	expiresAt: "2026-10-30T12:00:00.000Z",
	download: null,
	...patch,
});

const ready = job({
	state: "ready",
	fileName: "retrospend-2026-10-29.zip",
	download: {
		url: "/api/v1/exports/jobs/job-1/download?token=t",
		expiresAt: "2026-10-29T12:10:00.000Z",
	},
});

describe("waitForExport", () => {
	it("reads the job until it is ready, waiting longer each time", async () => {
		const states = [job({ state: "running" }), ready];
		const waits: number[] = [];
		const read = jest.fn(async () => states.shift() as ExportJobDto);
		const done = await waitForExport({
			request: async () => job({}),
			read,
			wait: async (ms) => {
				waits.push(ms);
			},
		});
		expect(done.download.url).toContain("/download?token=");
		expect(read).toHaveBeenCalledWith("job-1");
		expect(waits).toEqual([pollDelay(0), pollDelay(1)]);
	});

	it("returns at once when the job is ready on request", async () => {
		const read = jest.fn();
		await waitForExport({
			request: async () => ready,
			read,
			wait: async () => {},
		});
		expect(read).not.toHaveBeenCalled();
	});

	it("throws on a failed job", async () => {
		await expect(
			waitForExport({
				request: async () => job({}),
				read: async () => job({ state: "failed" }),
				wait: async () => {},
			}),
		).rejects.toBeInstanceOf(ExportFailedError);
	});

	it("gives up after the last read", async () => {
		const read = jest.fn(async () => job({ state: "running" }));
		await expect(
			waitForExport({
				request: async () => job({}),
				read,
				wait: async () => {},
			}),
		).rejects.toBeInstanceOf(ExportFailedError);
		expect(read).toHaveBeenCalledTimes(MAX_POLLS);
	});
});

describe("export files", () => {
	it("caps the wait between reads", () => {
		expect(pollDelay(0)).toBe(500);
		expect(pollDelay(10)).toBe(4000);
	});

	it("keeps a file name in the cache folder", () => {
		expect(safeFileName("../etc/passwd", "x.csv")).toBe(".._etc_passwd");
		expect(safeFileName("expenses-2026.csv", "x.csv")).toBe(
			"expenses-2026.csv",
		);
		expect(safeFileName(null, "x.csv")).toBe("x.csv");
		expect(safeFileName("..", "x.csv")).toBe("x.csv");
	});

	it("names the type for the share sheet", () => {
		expect(mimeOf("zip")).toBe("application/zip");
		expect(mimeOf("csv")).toBe("text/csv");
	});
});
