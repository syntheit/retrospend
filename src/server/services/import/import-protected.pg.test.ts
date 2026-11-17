/**
 * The import queue and a protected account, on real Postgres. A job of an
 * account whose protection is on is never read, claimed or sent to the
 * importer: it fails with the code `protected_account` in the unsealed
 * `statusMessage`, with no error text, no file and no rows, and no key is
 * made for it. The state is read again before a result is stored, so a flip
 * during the importer call (up to 5 minutes) stores nothing. An unprotected
 * account's job still runs. ARS home.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createUserScopedDb } from "~/server/db";
import { ensureUserKeyringWhenSealing } from "~/server/services/keys/data-key.service";
import { ImportQueueService } from "~/server/services/import-queue.service";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import {
	arsUser,
	isoDay,
	seedArsRates,
	TODAY,
} from "../accounts/test-fixtures";

// The importer call is faked and the importer's key is set before ~/env is read.
vi.hoisted(() => {
	process.env.WORKER_API_KEY = "pg-test-importer-key";
});

// The real state read, with a hook that runs just before it.
const watch = vi.hoisted(() => ({
	before: undefined as undefined | ((userId: string) => Promise<void>),
}));
vi.mock("~/server/api/protection/now", async (importOriginal) => {
	const real =
		await importOriginal<typeof import("~/server/api/protection/now")>();
	return {
		isProtectedNow: async (userId: string) => {
			await watch.before?.(userId);
			return real.isProtectedNow(userId);
		},
	};
});
// The real key function, watched: a refusal must never call it.
vi.mock("~/server/services/keys/data-key.service", async (importOriginal) => {
	const real =
		await importOriginal<
			typeof import("~/server/services/keys/data-key.service")
		>();
	return {
		...real,
		ensureUserKeyringWhenSealing: vi.fn(real.ensureUserKeyringWhenSealing),
	};
});

const importer = vi.fn(
	async () =>
		new Response(
			`${JSON.stringify({
				type: "result",
				data: [{ title: "Cafe", amount: 3500, currency: "ARS", date: DAY }],
				metadata: {},
			})}\n`,
		),
);
vi.stubGlobal("fetch", importer);

beforeAll(seedArsRates);
afterEach(() => {
	watch.before = undefined;
	importer.mockClear();
});

const DAY = isoDay(TODAY);
const CSV = `date,title,amount,currency\n${DAY},Cafe,3500,ARS\n`;

/** An ARS user with AI import on and one queued job of `type`. */
async function queued(type: "CSV" | "BANK_STATEMENT") {
	const { user } = await arsUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { aiImportEnabled: true },
	});
	const job = await fixtureDb.importJob.create({
		data: {
			userId: user.id,
			status: "QUEUED",
			type,
			fileName: "statement.csv",
			fileSize: CSV.length,
			fileType: "csv",
			fileData: Buffer.from(CSV).toString("base64"),
		},
	});
	return { userId: user.id, jobId: job.id };
}

const protect = (userId: string) =>
	adminDb.user.update({
		where: { id: userId },
		data: { protectionState: "ON" },
	});

const run = (userId: string) =>
	new ImportQueueService(createUserScopedDb(userId)).processQueue(userId);

/** The job as stored. */
async function stored(jobId: string) {
	return fixtureDb.importJob.findUniqueOrThrow({ where: { id: jobId } });
}

function expectRefused(job: Awaited<ReturnType<typeof stored>>) {
	expect(job).toMatchObject({
		status: "FAILED",
		statusMessage: "protected_account",
		errorMessage: null,
		fileData: null,
		transactions: null,
	});
	expect(job.failedAt).not.toBeNull();
}

describe("a protected account's import jobs", () => {
	it("are refused before the claim: no importer call, no rows, no error text, no key", async () => {
		const first = await queued("BANK_STATEMENT");
		const second = await fixtureDb.importJob.create({
			data: {
				userId: first.userId,
				status: "QUEUED",
				type: "CSV",
				fileName: "second.csv",
				fileSize: CSV.length,
				fileType: "csv",
				fileData: Buffer.from(CSV).toString("base64"),
			},
		});
		// Queued while unprotected, then protection turns on before the queue runs.
		await protect(first.userId);
		vi.mocked(ensureUserKeyringWhenSealing).mockClear();
		await run(first.userId);
		expect(importer).not.toHaveBeenCalled();
		expect(ensureUserKeyringWhenSealing).not.toHaveBeenCalled();
		for (const id of [first.jobId, second.id]) expectRefused(await stored(id));
		expect(
			await fixtureDb.expense.count({ where: { userId: first.userId } }),
		).toBe(0);
	});

	it("stop when protection turns on during the importer call: nothing is stored", async () => {
		const { userId, jobId } = await queued("BANK_STATEMENT");
		// Reads: before the claim, then before the result is stored.
		let reads = 0;
		watch.before = async () => {
			if (++reads === 2) await protect(userId);
		};
		await run(userId);
		expect(importer).toHaveBeenCalledTimes(1);
		expectRefused(await stored(jobId));
	});

	it("stop when protection turns on while a CSV is read: nothing is stored", async () => {
		const { userId, jobId } = await queued("CSV");
		let reads = 0;
		watch.before = async () => {
			if (++reads === 2) await protect(userId);
		};
		await run(userId);
		expectRefused(await stored(jobId));
	});
});

describe("a job that fails after protection turns on", () => {
	// Reads: before the claim, then in the failure handler.
	function flipAtFailure(userId: string) {
		let reads = 0;
		watch.before = async () => {
			if (++reads === 2) await protect(userId);
		};
	}

	it("keeps the importer's empty answer out of the error text", async () => {
		const { userId, jobId } = await queued("BANK_STATEMENT");
		importer.mockResolvedValueOnce(new Response(""));
		flipAtFailure(userId);
		await run(userId);
		expect(importer).toHaveBeenCalledTimes(1);
		expectRefused(await stored(jobId));
	});

	it("keeps the CSV's parse warnings, which quote the file, out of the error text", async () => {
		const { userId, jobId } = await queued("CSV");
		await fixtureDb.importJob.update({
			where: { id: jobId },
			data: {
				fileData: Buffer.from(
					"date,title,amount,currency\nayer-mismo,Kiosco,500,ARS\n",
				).toString("base64"),
			},
		});
		flipAtFailure(userId);
		await run(userId);
		expectRefused(await stored(jobId));
	});
});

describe("an unprotected account's import jobs", () => {
	it("still run: a CSV reaches review and a statement stores the importer's rows", async () => {
		const csv = await queued("CSV");
		await run(csv.userId);
		expect(await stored(csv.jobId)).toMatchObject({
			status: "READY_FOR_REVIEW",
			totalTransactions: 1,
			statusMessage: null,
		});
		const bank = await queued("BANK_STATEMENT");
		await run(bank.userId);
		expect(importer).toHaveBeenCalledTimes(1);
		expect(await stored(bank.jobId)).toMatchObject({
			status: "READY_FOR_REVIEW",
			totalTransactions: 1,
		});
	});
});
