/**
 * An import job's parsed rows and warnings (E2EE D11 PR 8.2) on Postgres, in
 * both suites: read from a CSV by the queue, reviewed, committed and undone,
 * every figure the same whether the two JSON columns are plain or sealed.
 * In the sealed suite each is stored as a `{ sealed }` envelope under the
 * owner's key and its own column and row, with the file's text nowhere in
 * the row; a body moved to another column or row fails instead of reading;
 * a row written before sealing still reads; and after a crypto-shred the
 * owner's rows are unreadable with the stable code.
 *
 * This does not make import text private by itself: the first warnings are
 * still copied into `errorMessage` when a file fails, and `fileData` holds
 * the file until it is read (Revision 3 seals those).
 *
 * ARS home. The file, three data rows (Row n counts them from 1):
 *   1 Farmacia del Pueblo  ARS 12,500  Rosario, "Ibuprofeno 400"
 *   2 Super Coto           ARS 38,200
 *   3 date "ayer-mismo"    unreadable: `Row 3: Invalid date "ayer-mismo", skipping`
 * Two rows import: ARS 12,500 + ARS 38,200 = ARS 50,700 (5,070,000 minor).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { openField } from "~/server/crypto/field-crypto";
import { textUnavailableProblem } from "~/server/crypto/field-open";
import { createUserScopedDb } from "~/server/db";
import { ImportQueueService } from "~/server/services/import-queue.service";
import {
	destroyDataKeys,
	ensureUserKeyring,
} from "~/server/services/keys/data-key.service";
import { forUser } from "~/server/services/preview";
import { adminDb, fixtureDb, sealedSuite } from "~/test/pg-harness";
import {
	arsUser,
	isoDay,
	seedArsRates,
	TODAY,
} from "../accounts/test-fixtures";
import { commitImport } from "./commit.mutation";
import { importReview } from "./review";
import { undoImport } from "./undo.mutation";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

beforeAll(seedArsRates);

const DAY = isoDay(TODAY);
const CSV = [
	"date,title,amount,currency,location,description",
	`${DAY},Farmacia del Pueblo,12500,ARS,Rosario,Ibuprofeno 400`,
	`${DAY},Super Coto,38200,ARS,,`,
	"ayer-mismo,Kiosco,500,ARS,,",
].join("\n");
const WARNING = 'Row 3: Invalid date "ayer-mismo", skipping';
const TEXTS = [
	"Farmacia del Pueblo",
	"Super Coto",
	"Rosario",
	"Ibuprofeno",
	"ayer-mismo",
];

/** A job read from CSV by the queue, as far as READY_FOR_REVIEW. */
async function readJob() {
	const { user } = await arsUser();
	const job = await fixtureDb.importJob.create({
		data: {
			userId: user.id,
			status: "QUEUED",
			type: "CSV",
			fileName: "galicia.csv",
			fileSize: CSV.length,
			fileType: "csv",
			fileData: Buffer.from(CSV).toString("base64"),
		},
	});
	await new ImportQueueService(createUserScopedDb(user.id)).processQueue(
		user.id,
	);
	return { userId: user.id, jobId: job.id };
}

type Stored = { transactions: unknown; warnings: unknown; text: string };

/** The job's two JSON columns as stored, and their text. */
async function atRest(jobId: string): Promise<Stored> {
	const [row] = await adminDb.$queryRaw<Stored[]>`
		SELECT "transactions", "warnings",
			COALESCE("transactions"::text, '') || COALESCE("warnings"::text, '') AS "text"
		FROM "import_job" WHERE "id" = ${jobId}`;
	if (!row) throw new Error(`no import_job ${jobId}`);
	return row;
}

/** A stored body as its owner opens it, under its own column and row. */
async function opened(
	userId: string,
	jobId: string,
	column: "transactions" | "warnings",
	value: unknown,
) {
	const { sealed } = value as { sealed: string };
	expect(sealed.startsWith("\u0001k1:")).toBe(true);
	expect(Object.keys(value as object)).toEqual(["sealed"]);
	return JSON.parse(
		openField(await ensureUserKeyring(userId), sealed, {
			table: "import_job",
			column,
			rowId: jobId,
		}),
	);
}

const choices = (n: number) =>
	Array.from({ length: n }, (_, index) => ({
		index,
		keep: true,
		categoryId: null,
		kind: "expense" as const,
	}));

describe("an import job's rows and warnings at rest", () => {
	it("holds the file's text only sealed in the sealed suite, and reads back the same", async () => {
		const { userId, jobId } = await readJob();
		const row = await atRest(jobId);
		for (const text of TEXTS)
			expect(row.text.includes(text)).toBe(!sealedSuite);

		if (sealedSuite) {
			const rows = await opened(
				userId,
				jobId,
				"transactions",
				row.transactions,
			);
			expect(rows).toHaveLength(2);
			expect(rows[0]).toMatchObject({
				title: "Farmacia del Pueblo",
				amount: 12500,
				currency: "ARS",
				location: "Rosario",
				description: "Ibuprofeno 400",
			});
			expect(await opened(userId, jobId, "warnings", row.warnings)).toEqual([
				WARNING,
			]);
		} else {
			expect(row.warnings).toEqual([WARNING]);
		}

		const read = await createUserScopedDb(userId).importJob.findUniqueOrThrow({
			where: { id: jobId },
			select: { status: true, totalTransactions: true, warnings: true },
		});
		expect(read).toEqual({
			status: "READY_FOR_REVIEW",
			totalTransactions: 2,
			warnings: [WARNING],
		});
	});
});

describe("review, commit and undo of a sealed job", () => {
	it("review, commit and undo agree with the file, and the job stays sealed after each write", async () => {
		const { userId, jobId } = await readJob();
		const review = await importReview(
			createUserScopedDb(userId),
			userId,
			jobId,
		);
		expect(review.counts).toEqual({
			fileRows: 3,
			unreadable: 1,
			duplicates: 0,
			noRate: 0,
		});
		expect(review.warnings).toEqual([WARNING]);
		expect(review.rows.map((r) => [r.title, r.home])).toEqual([
			["Farmacia del Pueblo", { minor: 1_250_000, currency: "ARS" }],
			["Super Coto", { minor: 3_820_000, currency: "ARS" }],
		]);

		const input = { jobId, rows: choices(2) };
		const preview = await forUser(userId).preview(commitImport, input);
		// A preview is a rolled-back write: the stored body is untouched.
		const before = await atRest(jobId);
		const applied = await forUser(userId).apply(commitImport, input);
		expect(applied.value).toEqual(preview.value);
		expect(applied.value).toMatchObject({
			fileRows: 3,
			created: 2,
			unreadable: 1,
			noRate: 0,
		});
		expect(applied.value.byKind).toEqual([
			{
				kind: "expense",
				count: 2,
				total: { minor: 5_070_000, currency: "ARS" },
				withoutRate: 0,
			},
		]);

		// The commit wrote each created row's id onto the job's rows.
		const committed = await fixtureDb.importJob.findUniqueOrThrow({
			where: { id: jobId },
		});
		const ids = (committed.transactions as { expenseId?: string }[]).map(
			(r) => r.expenseId,
		);
		expect(ids.every((id) => typeof id === "string")).toBe(true);
		const after = await atRest(jobId);
		for (const text of TEXTS)
			expect(after.text.includes(text)).toBe(!sealedSuite);
		if (sealedSuite) {
			// A new body under the same row id: a different ciphertext.
			expect(after.transactions).not.toEqual(before.transactions);
			expect(await opened(userId, jobId, "warnings", after.warnings)).toEqual([
				WARNING,
			]);
		}

		const undone = await forUser(userId).apply(undoImport, { jobId });
		expect(undone.value).toEqual({ jobId, removed: 2 });
		const back = await fixtureDb.importJob.findUniqueOrThrow({
			where: { id: jobId },
		});
		expect(back.status).toBe("READY_FOR_REVIEW");
		expect(
			(back.transactions as { expenseId?: string }[]).some((r) => r.expenseId),
		).toBe(false);
		const undoneRow = await atRest(jobId);
		for (const text of TEXTS)
			expect(undoneRow.text.includes(text)).toBe(!sealedSuite);
		expect(
			await fixtureDb.expense.count({
				where: { userId, pricingSource: "IMPORT" },
			}),
		).toBe(0);
	});
});

describe("a body moved to another column or row", () => {
	it.runIf(sealedSuite)(
		"fails the read instead of showing another body",
		async () => {
			const a = await readJob();
			const b = await readJob();
			const read = (job: { userId: string; jobId: string }) =>
				createUserScopedDb(job.userId).importJob.findUniqueOrThrow({
					where: { id: job.jobId },
					select: { transactions: true, warnings: true },
				});
			const own = await atRest(a.jobId);
			const ownB = await atRest(b.jobId);
			const put = (
				jobId: string,
				column: "transactions" | "warnings",
				v: unknown,
			) =>
				adminDb.$executeRawUnsafe(
					`UPDATE "import_job" SET "${column}" = $1::jsonb WHERE "id" = $2`,
					JSON.stringify(v),
					jobId,
				);
			try {
				// The warnings body where the rows belong, on the same row.
				await put(a.jobId, "transactions", own.warnings);
				await expect(read(a)).rejects.toMatchObject({ code: "auth_failed" });
				await put(a.jobId, "transactions", own.transactions);
				// The same column of another job (another owner too).
				await put(b.jobId, "transactions", own.transactions);
				await expect(read(b)).rejects.toMatchObject({ code: "auth_failed" });
			} finally {
				await put(a.jobId, "transactions", own.transactions);
				await put(a.jobId, "warnings", own.warnings);
				await put(b.jobId, "transactions", ownB.transactions);
			}
			await expect(read(a)).resolves.toMatchObject({ warnings: [WARNING] });
		},
	);
});

describe("a job written before sealing", () => {
	it("reads, reviews and commits as plaintext, and is sealed again by its next write", async () => {
		const { userId, jobId } = await readJob();
		const sealedRow = await atRest(jobId);
		const plain = [
			{
				title: "Kiosco legado",
				amount: 700,
				currency: "ARS",
				date: DAY,
				location: "",
				description: "",
				pricingSource: "IMPORT",
				category: "",
			},
		];
		const put = (column: string, value: unknown) =>
			adminDb.$executeRawUnsafe(
				`UPDATE "import_job" SET "${column}" = $1::jsonb, "totalTransactions" = 1 WHERE "id" = $2`,
				JSON.stringify(value),
				jobId,
			);
		try {
			await put("transactions", plain);
			await put("warnings", ["Row 2: Missing date, skipping"]);
			const review = await importReview(
				createUserScopedDb(userId),
				userId,
				jobId,
			);
			expect(review.counts).toMatchObject({ fileRows: 2, unreadable: 1 });
			expect(review.rows.map((r) => r.home)).toEqual([
				{ minor: 70_000, currency: "ARS" },
			]);

			// The commit rewrites `transactions` (the created id): sealed now.
			await forUser(userId).apply(commitImport, { jobId, rows: choices(1) });
			const written = await atRest(jobId);
			expect(written.text.includes("Kiosco legado")).toBe(!sealedSuite);
			if (sealedSuite) {
				const rows = await opened(
					userId,
					jobId,
					"transactions",
					written.transactions,
				);
				expect(rows[0]).toMatchObject({ title: "Kiosco legado" });
				expect(rows[0].expenseId).toEqual(expect.any(String));
				// `warnings` was not written, so it is the legacy plaintext still.
				expect(written.warnings).toEqual(["Row 2: Missing date, skipping"]);
			}
		} finally {
			// Leave nothing in plaintext for the sweep: the seeded sealed bodies.
			await adminDb.$executeRawUnsafe(
				`UPDATE "import_job" SET "transactions" = $1::jsonb, "warnings" = $2::jsonb WHERE "id" = $3`,
				JSON.stringify(sealedRow.transactions),
				JSON.stringify(sealedRow.warnings),
				jobId,
			);
		}
	});
});

describe("a crypto-shred", () => {
	it.runIf(sealedSuite)(
		"makes the owner's import rows unreadable with the stable code",
		async () => {
			const { userId, jobId } = await readJob();
			const read = () =>
				createUserScopedDb(userId).importJob.findUniqueOrThrow({
					where: { id: jobId },
					select: { id: true, transactions: true },
				});
			await expect(read()).resolves.toMatchObject({ id: jobId });
			await destroyDataKeys(userId);
			const failure = await read().then(
				() => undefined,
				(error: unknown) => error,
			);
			expect(textUnavailableProblem(failure)).toBe(
				"encrypted_text_unavailable",
			);
			// The row without its JSON still reads: nothing else was sealed.
			await expect(
				createUserScopedDb(userId).importJob.findUniqueOrThrow({
					where: { id: jobId },
					select: { id: true, status: true },
				}),
			).resolves.toEqual({ id: jobId, status: "READY_FOR_REVIEW" });
		},
	);
});
