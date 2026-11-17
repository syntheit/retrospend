/**
 * A protected account's export is never built or stored: refused before the
 * claim, and again after the build, with `protected_account` in `error`.
 * An export job finishes by id (the file name is user text, sealed under its
 * row id, so no updateMany): a job deleted while its file
 * was built leaves no row and no file; a live one ends READY with its name.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { runExportJob } from "./export-run";

const storage = vi.hoisted(() => ({
	deleteJobOnPut: false,
	removed: [] as string[],
	puts: [] as string[],
}));

// The real state read, with a hook that runs just before it.
const watch = vi.hoisted(() => ({
	before: undefined as undefined | ((userId: string) => Promise<void>),
}));
vi.mock("~/server/services/protection/now", async (importOriginal) => {
	const real =
		await importOriginal<typeof import("~/server/services/protection/now")>();
	return {
		isProtectedNow: async (userId: string) => {
			await watch.before?.(userId);
			return real.isProtectedNow(userId);
		},
	};
});

vi.mock("~/server/export-storage", () => ({
	newExportPath: (userId: string, jobId: string) => `${userId}/${jobId}/file`,
	putExport: async (path: string) => {
		storage.puts.push(path);
		// The owner deletes the job while the file is being stored.
		if (storage.deleteJobOnPut)
			await adminDb.exportJob.deleteMany({
				where: { id: path.split("/")[1] },
			});
	},
	removeExport: async (path: string) => {
		storage.removed.push(path);
	},
}));

beforeEach(() => {
	storage.deleteJobOnPut = false;
	storage.removed = [];
	storage.puts = [];
	watch.before = undefined;
});

async function queuedJob() {
	const { user } = await createTestUser();
	const job = await fixtureDb.exportJob.create({
		data: {
			userId: user.id,
			kind: "data",
			params: {},
			timeZone: "UTC",
			expiresAt: new Date(Date.now() + 3_600_000),
		},
	});
	return { userId: user.id, jobId: job.id };
}

describe("runExportJob", () => {
	it("marks a live job READY with its file name", async () => {
		const { userId, jobId } = await queuedJob();
		await runExportJob(jobId, userId);
		const job = await fixtureDb.exportJob.findUniqueOrThrow({
			where: { id: jobId },
		});
		expect(job.status).toBe("READY");
		expect(job.fileName).toMatch(/\.zip$/);
		expect(storage.removed).toEqual([]);
	});

	it("removes the file of a job deleted while it ran", async () => {
		const { userId, jobId } = await queuedJob();
		storage.deleteJobOnPut = true;
		await runExportJob(jobId, userId);
		expect(
			await fixtureDb.exportJob.findUnique({ where: { id: jobId } }),
		).toBeNull();
		expect(storage.removed).toEqual([`${userId}/${jobId}/file`]);
	});

	it("refuses a job queued while unprotected once protection is on: not claimed, no file", async () => {
		const { userId, jobId } = await queuedJob();
		await adminDb.user.update({
			where: { id: userId },
			data: { protectionState: "ON" },
		});
		await runExportJob(jobId, userId);
		const job = await fixtureDb.exportJob.findUniqueOrThrow({
			where: { id: jobId },
		});
		expect(job).toMatchObject({
			status: "FAILED",
			error: "protected_account",
			startedAt: null,
			storagePath: null,
		});
		expect(storage.puts).toEqual([]);
	});

	it("stores no file when protection turns on while the export is built", async () => {
		const { userId, jobId } = await queuedJob();
		// Reads: before the claim, then after the build, before the file is stored.
		let reads = 0;
		watch.before = async () => {
			if (++reads === 2)
				await adminDb.user.update({
					where: { id: userId },
					data: { protectionState: "ON" },
				});
		};
		await runExportJob(jobId, userId);
		const job = await fixtureDb.exportJob.findUniqueOrThrow({
			where: { id: jobId },
		});
		expect(job).toMatchObject({
			status: "FAILED",
			error: "protected_account",
			storagePath: null,
		});
		expect(job.startedAt).not.toBeNull();
		expect(storage.puts).toEqual([]);
	});
});
