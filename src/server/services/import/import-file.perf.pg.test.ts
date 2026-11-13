/**
 * The largest import file the queue takes (10 MB, 13.98 million characters of
 * base64) sealed on create and opened for the queue, with timing budgets
 * (E2EE D11 Revision 3, PR 5). It runs alone, after the other pg files
 * (vitest.pg.config.ts), so other workers cannot skew it. The budgets are
 * never loosened. ARS home, one user.
 */
import { describe, expect, it, vi } from "vitest";
import { createUserScopedDb } from "~/server/db";
import { ImportQueueService } from "~/server/services/import-queue.service";
import { adminDb, sealedSuite } from "~/test/pg-harness";
import { arsUser } from "../accounts/test-fixtures";

const MB = 1024 * 1024;
const BUDGET_MS = 4000;

describe("a 10 MB import file", () => {
	it("is sealed on create and opened for the queue within budget, and comes back whole", async () => {
		const { user } = await arsUser();
		const scoped = createUserScopedDb(user.id);
		const base64 = Buffer.alloc(10 * MB, "a").toString("base64");
		expect(base64.length).toBeLessThanOrEqual(14_000_000);

		// The queue would read the file at once; this test reads it itself.
		const idle = vi
			.spyOn(ImportQueueService.prototype, "processQueue")
			.mockResolvedValue();
		const t0 = performance.now();
		const job = await new ImportQueueService(scoped).createJob(user.id, {
			fileName: "grande.csv",
			fileSize: 10 * MB,
			fileType: "csv",
			type: "CSV",
			fileData: base64,
		});
		const created = performance.now() - t0;
		idle.mockRestore();

		const [raw] = await adminDb.$queryRaw<{ stored: number }[]>`
			SELECT length("fileData")::int AS "stored" FROM "import_job" WHERE "id" = ${job.id}`;
		// Sealed: 4 characters of marker and key, then base64 of the key id, nonce,
		// ciphertext and tag (4 + 12 + 16 bytes over the plaintext).
		const sealedLength = 4 + 4 * Math.ceil((base64.length + 32) / 3);
		expect(raw?.stored).toBe(sealedSuite ? sealedLength : base64.length);

		const t1 = performance.now();
		const read = await scoped.importJob.findFirstOrThrow({
			where: { id: job.id },
			select: { fileData: true },
		});
		const opened = performance.now() - t1;

		expect(read.fileData).toBe(base64);
		expect(created).toBeLessThan(BUDGET_MS);
		expect(opened).toBeLessThan(BUDGET_MS);
	});
});
