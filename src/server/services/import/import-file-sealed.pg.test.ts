/**
 * An import job's file and failure text (E2EE D11 Revision 3, PR 5) on
 * Postgres, in both suites. `fileData` is the uploaded file as base64 and
 * `errorMessage` the failure text, which quotes rows of that file; both are
 * user-class cells, sealed under the owner's key and their own column and row
 * in the sealed suite and plain text without it. The stale-job sweep fails a
 * job that waited or ran an hour and clears its file; a run that finishes
 * after the sweep never brings the job back.
 *
 * ARS home. The failing file, three data rows, nothing importable:
 *   1 Super Coto       amount "abc"          Row 1: Invalid amount "abc", skipping
 *   2 Farmacia         amount "-5"           Row 2: Invalid amount "-5", skipping
 *   3 Kiosco           date "ayer-mismo"     Row 3: Invalid date "ayer-mismo", skipping
 * so the job fails with those three warnings after the fixed lead.
 */
import { contract } from "@retrospend/api-contract";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	asMobile,
	call,
	expectBody,
} from "~/server/api/v1/core/__tests__/harness";
import { openField } from "~/server/crypto/field-crypto";
import { textUnavailableProblem } from "~/server/crypto/field-open";
import { createUserScopedDb } from "~/server/db";
import { sweepStaleImportFiles } from "~/server/services/api-v1/retention-sweep";
import { ImportQueueService } from "~/server/services/import-queue.service";
import {
	destroyDataKeys,
	ensureUserKeyring,
} from "~/server/services/keys/data-key.service";
import { adminDb, fixtureDb, sealedSuite } from "~/test/pg-harness";
import {
	arsUser,
	isoDay,
	seedArsRates,
	TODAY,
} from "../accounts/test-fixtures";
import type { ImportJobStatus } from "~prisma";
import { recentImports } from "./recent";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

beforeAll(seedArsRates);
afterEach(() => vi.restoreAllMocks());

const DAY = isoDay(TODAY);
const GOOD = [
	"date,title,amount,currency",
	`${DAY},Farmacia del Pueblo,12500,ARS`,
	`${DAY},Super Coto,38200,ARS`,
].join("\n");
const BAD = [
	"date,title,amount,currency",
	`${DAY},Super Coto,abc,ARS`,
	`${DAY},Farmacia,-5,ARS`,
	"ayer-mismo,Kiosco,500,ARS",
].join("\n");
const FAILURE =
	"No valid transactions found in CSV. Warnings: " +
	'Row 1: Invalid amount "abc", skipping; ' +
	'Row 2: Invalid amount "-5", skipping; ' +
	'Row 3: Invalid date "ayer-mismo", skipping';
const b64 = (text: string) => Buffer.from(text).toString("base64");
const MIN = 60_000;

const owned = async () => (await arsUser()).user.id;

/** A job as the queue's create would write it, on the owner's key in the sealed suite. */
function queued(
	userId: string,
	csv: string,
	ageMin = 0,
	status: ImportJobStatus = "QUEUED",
	now = new Date(),
) {
	return fixtureDb.importJob.create({
		data: {
			userId,
			status,
			type: "CSV",
			fileName: "galicia.csv",
			fileSize: csv.length,
			fileType: "csv",
			fileData: b64(csv),
			createdAt: new Date(now.getTime() - ageMin * MIN),
		},
		select: { id: true },
	});
}

type Raw = {
	status: string;
	fileData: string | null;
	errorMessage: string | null;
	statusMessage: string | null;
	failedAt: Date | null;
};

async function rawJob(id: string): Promise<Raw> {
	const [row] = await adminDb.$queryRaw<Raw[]>`
		SELECT "status"::text AS "status", "fileData", "errorMessage", "statusMessage", "failedAt"
		FROM "import_job" WHERE "id" = ${id}`;
	if (!row) throw new Error(`no import_job ${id}`);
	return row;
}

const MARKER = "\u0001k1:";

/** A stored cell as its owner opens it, under its own column and row. */
async function opened(
	userId: string,
	id: string,
	column: "fileData" | "errorMessage",
	stored: string | null,
) {
	expect(stored?.startsWith(MARKER)).toBe(true);
	return openField(await ensureUserKeyring(userId), stored as string, {
		table: "import_job",
		column,
		rowId: id,
	});
}

const queue = (userId: string) =>
	new ImportQueueService(createUserScopedDb(userId));

describe("the file of a queued job", () => {
	it("is sealed at rest only in the sealed suite, never returned by create, and gone once read", async () => {
		const userId = await owned();
		const idle = vi
			.spyOn(ImportQueueService.prototype, "processQueue")
			.mockResolvedValue();
		const job = await queue(userId).createJob(userId, {
			fileName: "galicia.csv",
			fileSize: GOOD.length,
			fileType: "csv",
			type: "CSV",
			fileData: b64(GOOD),
		});
		idle.mockRestore();

		// The response names the job and its state, not the file or any text.
		expect(Object.keys(job).sort()).toEqual([
			"createdAt",
			"id",
			"status",
			"type",
		]);
		expect(JSON.stringify(job)).not.toContain(b64(GOOD).slice(0, 20));

		const queuedRow = await rawJob(job.id);
		expect(queuedRow.status).toBe("QUEUED");
		if (sealedSuite) {
			expect(queuedRow.fileData).not.toContain(b64(GOOD).slice(0, 20));
			expect(await opened(userId, job.id, "fileData", queuedRow.fileData)).toBe(
				b64(GOOD),
			);
		} else {
			expect(queuedRow.fileData).toBe(b64(GOOD));
		}

		await queue(userId).processQueue(userId);
		const read = await rawJob(job.id);
		expect(read.status).toBe("READY_FOR_REVIEW");
		expect(read.fileData).toBeNull();
		expect(read.errorMessage).toBeNull();
	});

	it("is read as plaintext from a row written before sealing", async () => {
		const userId = await owned();
		const job = await queued(userId, GOOD);
		await adminDb.$executeRaw`
			UPDATE "import_job" SET "fileData" = ${b64(GOOD)} WHERE "id" = ${job.id}`;
		expect((await rawJob(job.id)).fileData).toBe(b64(GOOD));

		await queue(userId).processQueue(userId);
		const row = await rawJob(job.id);
		expect(row.status).toBe("READY_FOR_REVIEW");
		expect(row.fileData).toBeNull();
		const read = await fixtureDb.importJob.findUniqueOrThrow({
			where: { id: job.id },
			select: { totalTransactions: true },
		});
		// ARS 12,500 and ARS 38,200 are two rows.
		expect(read.totalTransactions).toBe(2);
	});
});

describe("the failure text of a job", () => {
	async function failedJob() {
		const userId = await owned();
		const job = await queued(userId, BAD);
		await queue(userId).processQueue(userId);
		return { userId, id: job.id };
	}

	it("is sealed at rest only in the sealed suite, and opened by the list and by v1", async () => {
		const { userId, id } = await failedJob();
		const row = await rawJob(id);
		expect(row.status).toBe("FAILED");
		expect(row.fileData).toBeNull();
		expect(row.failedAt).toBeInstanceOf(Date);
		if (sealedSuite) {
			expect(row.errorMessage).not.toContain("ayer-mismo");
			expect(await opened(userId, id, "errorMessage", row.errorMessage)).toBe(
				FAILURE,
			);
		} else {
			expect(row.errorMessage).toBe(FAILURE);
		}

		const recent = await recentImports(createUserScopedDb(userId), userId);
		expect(recent.find((j) => j.id === id)).toMatchObject({
			state: "failed",
			error: FAILURE,
		});

		const v1 = await expectBody<{ state: string; error: string | null }>(
			await call(`/imports/jobs/${id}`, { headers: await asMobile(userId) }),
			contract.imports.getJob,
		);
		expect(v1).toMatchObject({ state: "failed", error: FAILURE });
	});

	it("reads a plaintext message from a row written before sealing", async () => {
		const { userId, id } = await failedJob();
		const sealed = (await rawJob(id)).errorMessage;
		const put = (value: string | null) =>
			adminDb.$executeRaw`UPDATE "import_job" SET "errorMessage" = ${value} WHERE "id" = ${id}`;
		try {
			await put("Importer service error [500]: boom");
			const recent = await recentImports(createUserScopedDb(userId), userId);
			expect(recent.find((j) => j.id === id)?.error).toBe(
				"Importer service error [500]: boom",
			);
		} finally {
			// Nothing left in plaintext for the sealed suite's sweep.
			await put(sealed);
		}
	});

	it.runIf(sealedSuite)(
		"fails the read when a cell is moved to another column or another job",
		async () => {
			const a = await failedJob();
			const b = await failedJob();
			const rowA = await rawJob(a.id);
			const rowB = await rawJob(b.id);
			const read = (job: { userId: string; id: string }) =>
				createUserScopedDb(job.userId).importJob.findFirstOrThrow({
					where: { id: job.id },
					select: { id: true, errorMessage: true },
				});
			const put = (id: string, value: string | null) =>
				adminDb.$executeRaw`UPDATE "import_job" SET "errorMessage" = ${value} WHERE "id" = ${id}`;
			try {
				// Another job's failure text (same lead, other row and owner).
				await put(a.id, rowB.errorMessage);
				await expect(read(a)).rejects.toMatchObject({ code: "auth_failed" });
			} finally {
				await put(a.id, rowA.errorMessage);
			}
			await expect(read(a)).resolves.toMatchObject({ errorMessage: FAILURE });

			// A queued file moved to another job (and owner), then into the error
			// column of its own row.
			const fa = await queued(a.userId, GOOD);
			const fb = await queued(b.userId, GOOD);
			const fileA = (await rawJob(fa.id)).fileData;
			const fileB = (await rawJob(fb.id)).fileData;
			const readFile = () =>
				createUserScopedDb(a.userId).importJob.findFirstOrThrow({
					where: { id: fa.id },
					select: { id: true, fileData: true },
				});
			const readError = () =>
				createUserScopedDb(a.userId).importJob.findFirstOrThrow({
					where: { id: fa.id },
					select: { id: true, errorMessage: true },
				});
			await adminDb.$executeRaw`UPDATE "import_job" SET "fileData" = ${fileB} WHERE "id" = ${fa.id}`;
			await expect(readFile()).rejects.toMatchObject({ code: "auth_failed" });
			await adminDb.$executeRaw`UPDATE "import_job" SET "fileData" = ${fileA}, "errorMessage" = ${fileA} WHERE "id" = ${fa.id}`;
			await expect(readError()).rejects.toMatchObject({ code: "auth_failed" });
			await adminDb.$executeRaw`UPDATE "import_job" SET "errorMessage" = NULL WHERE "id" = ${fa.id}`;
			await expect(readFile()).resolves.toMatchObject({ fileData: b64(GOOD) });
		},
	);

	it.runIf(sealedSuite)(
		"fails the list with the stable code when the owner's key is gone, and the row without text still reads",
		async () => {
			const { userId, id } = await failedJob();
			await destroyDataKeys(userId);
			const failure = await recentImports(
				createUserScopedDb(userId),
				userId,
			).then(
				() => undefined,
				(error: unknown) => error,
			);
			expect(textUnavailableProblem(failure)).toBe(
				"encrypted_text_unavailable",
			);
			await expect(
				createUserScopedDb(userId).importJob.findFirstOrThrow({
					where: { id },
					select: { id: true, status: true },
				}),
			).resolves.toEqual({ id, status: "FAILED" });
		},
	);
});

describe("the stale-job sweep", () => {
	const at = async (userId: string, ageMin: number, status: ImportJobStatus) =>
		(await queued(userId, GOOD, ageMin, status)).id;

	it("fails a job older than an hour, keeps a younger one, and clears the file with no reason text", async () => {
		const userId = await owned();
		// One clock for the ages and the sweep, so 60 minutes is exactly 60.
		const now = new Date();
		const at = async (ageMin: number, status: ImportJobStatus) =>
			(await queued(userId, GOOD, ageMin, status, now)).id;
		const old = await at(61, "QUEUED");
		const running = await at(90, "PROCESSING");
		const young = await at(59, "QUEUED");
		const edge = await at(60, "QUEUED");
		const swept = await sweepStaleImportFiles(now);

		expect(swept).toBeGreaterThanOrEqual(2);
		for (const id of [old, running]) {
			const row = await rawJob(id);
			expect(row.status).toBe("FAILED");
			expect(row.fileData).toBeNull();
			expect(row.errorMessage).toBeNull();
			expect(row.failedAt?.getTime()).toBe(now.getTime());
		}
		for (const id of [young, edge]) {
			const row = await rawJob(id);
			expect(row.status).toBe("QUEUED");
			expect(row.failedAt).toBeNull();
			expect(row.fileData).not.toBeNull();
			if (sealedSuite) expect(row.fileData?.startsWith(MARKER)).toBe(true);
		}
	});

	it("leaves a job that is past waiting alone, whatever its age, and sweeps every user's", async () => {
		const mine = await owned();
		const theirs = await owned();
		const ready = await at(mine, 600, "READY_FOR_REVIEW");
		const done = await at(mine, 600, "COMPLETED");
		const failed = await at(mine, 600, "FAILED");
		await adminDb.$executeRaw`
			UPDATE "import_job" SET "fileData" = NULL, "failedAt" = NULL WHERE "id" IN (${ready}, ${done}, ${failed})`;
		const other = await at(theirs, 120, "QUEUED");

		await sweepStaleImportFiles(new Date());

		expect((await rawJob(ready)).status).toBe("READY_FOR_REVIEW");
		expect((await rawJob(done)).status).toBe("COMPLETED");
		const stillFailed = await rawJob(failed);
		expect(stillFailed.status).toBe("FAILED");
		expect(stillFailed.failedAt).toBeNull();
		expect((await rawJob(other)).status).toBe("FAILED");
		expect((await rawJob(other)).fileData).toBeNull();
	});

	it("shows the job as failed to its owner, with no reason", async () => {
		const userId = await owned();
		const id = await at(userId, 120, "QUEUED");
		await sweepStaleImportFiles(new Date());
		const recent = await recentImports(createUserScopedDb(userId), userId);
		expect(recent.find((j) => j.id === id)).toMatchObject({
			state: "failed",
			error: null,
		});
	});

	it("never brings a job back when the run it interrupted finishes", async () => {
		const userId = await owned();
		const job = await queued(userId, GOOD, 120);
		const scoped = createUserScopedDb(userId);
		// The sweep lands between the queue's read and its final write.
		const racing = new Proxy(scoped, {
			get(target, key, receiver) {
				if (key !== "importJob") return Reflect.get(target, key, receiver);
				return new Proxy(target.importJob, {
					get(model, method) {
						if (method !== "update") return Reflect.get(model, method);
						return async (args: { data: { status?: string } }) => {
							if (args.data.status === "READY_FOR_REVIEW")
								await sweepStaleImportFiles(new Date());
							return model.update(args as never);
						};
					},
				});
			},
		});
		await new ImportQueueService(racing).processQueue(userId);

		const row = await rawJob(job.id);
		expect(row.status).toBe("FAILED");
		expect(row.fileData).toBeNull();
		expect(row.errorMessage).toBeNull();
		const rows = await adminDb.$queryRaw<{ transactions: unknown }[]>`
			SELECT "transactions" FROM "import_job" WHERE "id" = ${job.id}`;
		expect(rows[0]?.transactions).toBeNull();
	});
});

describe("the progress message of v1", () => {
	it("renders a code as the phrase it always showed and passes an old phrase through", async () => {
		const userId = await owned();
		const job = await queued(userId, GOOD, 0, "PROCESSING");
		const headers = await asMobile(userId);
		const message = async (stored: string | null) => {
			await adminDb.$executeRaw`
				UPDATE "import_job" SET "statusMessage" = ${stored} WHERE "id" = ${job.id}`;
			return (
				await expectBody<{ message: string | null }>(
					await call(`/imports/jobs/${job.id}`, { headers }),
					contract.imports.getJob,
				)
			).message;
		};
		expect(await message("enriching_batch:2/5")).toBe(
			"Enriching transactions (batch 2/5)...",
		);
		expect(await message("parsing_pages:1-3")).toBe(
			"Parsing bank statement (pages 1-3)...",
		);
		expect(await message("complete")).toBe("Complete");
		// Rows from before the codes hold the phrase itself.
		expect(await message("Detecting CSV format...")).toBe(
			"Detecting CSV format...",
		);
		expect(await message(null)).toBeNull();
	});
});

describe.runIf(sealedSuite)(
	"a write on a job whose owner's key is gone",
	() => {
		// The key is lost on a fresh client: cells cannot be opened, but a write
		// that returns no text must still succeed and stay committed.
		it("cancels a queued job, deletes a failed one and sweeps a stale one", async () => {
			const userId = await owned();
			const toCancel = await queued(userId, GOOD);
			const stale = await queued(userId, GOOD, 120);
			const toDelete = await queued(userId, BAD);
			await adminDb.$executeRaw`
				UPDATE "import_job" SET "status" = 'FAILED' WHERE "id" = ${toDelete.id}`;
			await destroyDataKeys(userId);

			const service = queue(userId);
			await expect(service.cancelJob(userId, toCancel.id)).resolves.toEqual({
				id: toCancel.id,
				status: "CANCELLED",
			});
			expect((await rawJob(toCancel.id)).fileData).toBeNull();

			await expect(service.deleteJob(userId, toDelete.id)).resolves.toEqual({
				success: true,
			});
			const left = await adminDb.$queryRaw<{ n: number }[]>`
				SELECT count(*)::int AS "n" FROM "import_job"
				WHERE "id" = ${toDelete.id}`;
			expect(left[0]?.n).toBe(0);

			await sweepStaleImportFiles(new Date());
			const swept = await rawJob(stale.id);
			expect(swept.status).toBe("FAILED");
			expect(swept.fileData).toBeNull();
		});
	},
);
