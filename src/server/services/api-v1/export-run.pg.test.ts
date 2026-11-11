/**
 * An export job finishes by id (E2EE D11 PR 4.1: the file name is user text,
 * sealed under its row id, so no updateMany): a job deleted while its file
 * was built leaves no row and no file; a live one ends READY with its name.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { runExportJob } from "./export-run";

const storage = vi.hoisted(() => ({
	deleteJobOnPut: false,
	removed: [] as string[],
}));

vi.mock("~/server/export-storage", () => ({
	newExportPath: (userId: string, jobId: string) => `${userId}/${jobId}/file`,
	putExport: async (path: string) => {
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
});

async function queuedJob() {
	const { user } = await createTestUser();
	const job = await adminDb.exportJob.create({
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
		const job = await adminDb.exportJob.findUniqueOrThrow({
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
			await adminDb.exportJob.findUnique({ where: { id: jobId } }),
		).toBeNull();
		expect(storage.removed).toEqual([`${userId}/${jobId}/file`]);
	});
});
