import type {
	CursorQuery,
	ImportJobDto,
	ImportReviewDto,
	ImportSummaryDto,
	PreviewResult,
} from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import {
	type CommitImportInput,
	commitImport,
} from "~/server/services/import/commit.mutation";
import { importReview } from "~/server/services/import/review";
import { importRunner } from "~/server/services/import/runner";
import { undoImport } from "~/server/services/import/undo.mutation";
import { ImportQueueService } from "~/server/services/import-queue.service";
import type { ImportJobStatus, ImportJobType, Prisma } from "~prisma";
import { decodeCursor, toPage } from "./cursor";
import type { LedgerCaller } from "./money-op";
import { toPreviewDto } from "./money-write";
import { type Wire, wire } from "./wire";

/**
 * v1 adapters for /imports. The queue, the review and the commit are the
 * ones the web runs (ImportQueueService, importReview, commitImport,
 * undoImport); this file only translates names and shapes. Files and rows
 * never leave through the job: the select below leaves out fileData and
 * the stored rows.
 */

const STATES: Record<ImportJobStatus, ImportJobDto["state"]> = {
	QUEUED: "queued",
	PROCESSING: "reading",
	READY_FOR_REVIEW: "ready",
	REVIEWING: "reviewing",
	COMPLETED: "imported",
	FAILED: "failed",
	CANCELLED: "cancelled",
};

const SOURCES: Record<ImportJobType, ImportJobDto["source"]> = {
	CSV: "csv",
	BANK_STATEMENT: "bank_statement",
};

const FILE_TYPES = ["csv", "xlsx", "pdf"] as const;

const jobSelect = {
	id: true,
	status: true,
	type: true,
	fileName: true,
	fileType: true,
	totalTransactions: true,
	importedCount: true,
	skippedDuplicates: true,
	warnings: true,
	errorMessage: true,
	progressPercent: true,
	statusMessage: true,
	createdAt: true,
	completedAt: true,
} satisfies Prisma.ImportJobSelect;

type JobRow = Prisma.ImportJobGetPayload<{ select: typeof jobSelect }>;

function toDto(row: JobRow): ImportJobDto {
	const fileType = FILE_TYPES.find((t) => t === row.fileType) ?? "csv";
	return {
		id: row.id,
		fileName: row.fileName,
		fileType,
		source: SOURCES[row.type],
		state: STATES[row.status],
		percent:
			row.status === "PROCESSING" && row.progressPercent != null
				? Math.round(row.progressPercent * 100)
				: null,
		message: row.statusMessage,
		rowCount: row.totalTransactions,
		importedCount: row.importedCount,
		skippedDuplicates: row.skippedDuplicates,
		warnings: Array.isArray(row.warnings)
			? row.warnings.filter((w): w is string => typeof w === "string")
			: [],
		error: row.errorMessage,
		createdAt: row.createdAt.toISOString(),
		completedAt: row.completedAt?.toISOString() ?? null,
	};
}

const notFound = () =>
	new TRPCError({ code: "NOT_FOUND", message: "Import not found" });

async function readJob(caller: LedgerCaller, id: string): Promise<JobRow> {
	const row = await caller.db.importJob.findFirst({
		where: { id, userId: caller.principal.userId },
		select: jobSelect,
	});
	if (!row) throw notFound();
	return row;
}

const createdCursor = z.object({ createdAt: z.iso.datetime(), id: z.string() });

export async function listJobs(caller: LedgerCaller, q: CursorQuery) {
	const after = decodeCursor(q.cursor, createdCursor);
	const rows = await caller.db.importJob.findMany({
		where: {
			userId: caller.principal.userId,
			...(after
				? {
						OR: [
							{ createdAt: { lt: new Date(after.createdAt) } },
							{ createdAt: new Date(after.createdAt), id: { lt: after.id } },
						],
					}
				: {}),
		},
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: q.limit + 1,
		select: jobSelect,
	});
	return toPage(
		rows,
		q.limit,
		(r) => ({ createdAt: r.createdAt.toISOString(), id: r.id }),
		toDto,
	);
}

export async function getJob(caller: LedgerCaller, id: string) {
	return toDto(await readJob(caller, id));
}

function fileTypeOf(name: string): (typeof FILE_TYPES)[number] {
	const ext = name.split(".").pop()?.toLowerCase();
	const found = FILE_TYPES.find((t) => t === ext);
	if (!found)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Upload a .csv, .xlsx or .pdf file",
		});
	return found;
}

export async function upload(
	caller: LedgerCaller,
	input: { file: File; source: ImportJobDto["source"] },
) {
	const { file, source } = input;
	if (file.name.length > 255)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "The file name is longer than 255 characters",
		});
	const bytes = Buffer.from(await file.arrayBuffer());
	const job = await new ImportQueueService(caller.db).createJob(
		caller.principal.userId,
		{
			fileName: file.name,
			fileSize: bytes.length,
			fileType: fileTypeOf(file.name),
			type: source === "csv" ? "CSV" : "BANK_STATEMENT",
			fileData: bytes.toString("base64"),
		},
	);
	return toDto(await readJob(caller, job.id));
}

export async function review(
	caller: LedgerCaller,
	input: { id: string; currency?: string },
): Promise<ImportReviewDto> {
	const r = await importReview(caller.db, caller.principal.userId, input.id, {
		currency: input.currency,
		timeZone: caller.timeZone,
	});
	const { type, ...rest } = wire(r);
	return { ...rest, source: SOURCES[type] };
}

/** The contract names the job `id` (it is a path parameter). */
type FinalizeBody = {
	id: string;
	currency?: string | null;
	rows: CommitImportInput["rows"];
};

const toCommit = (
	caller: LedgerCaller,
	b: FinalizeBody,
): CommitImportInput => ({
	jobId: b.id,
	currency: b.currency,
	rows: b.rows,
	timeZone: caller.timeZone,
});

export async function finalize(
	caller: LedgerCaller,
	input: FinalizeBody,
): Promise<ImportSummaryDto> {
	const { value } = await importRunner(caller.principal.userId).apply(
		commitImport,
		toCommit(caller, input),
	);
	return wire(value) as ImportSummaryDto;
}

export async function previewFinalize(
	caller: LedgerCaller,
	input: FinalizeBody,
): Promise<PreviewResult> {
	const preview = await importRunner(caller.principal.userId).preview(
		commitImport,
		toCommit(caller, input),
	);
	return withResult(preview, commitImport.id);
}

export async function undo(caller: LedgerCaller, id: string) {
	await readJob(caller, id);
	const { value } = await importRunner(caller.principal.userId).apply(
		undoImport,
		{ jobId: id, timeZone: caller.timeZone },
	);
	return wire(value);
}

export async function previewUndo(caller: LedgerCaller, id: string) {
	await readJob(caller, id);
	const preview = await importRunner(caller.principal.userId).preview(
		undoImport,
		{ jobId: id, timeZone: caller.timeZone },
	);
	return withResult(preview, undoImport.id);
}

function withResult<V>(
	preview: Parameters<typeof toPreviewDto>[0] & { value: V },
	kind: string,
): PreviewResult {
	return {
		...toPreviewDto(preview),
		detail: { kind, result: wire(preview.value) as Wire<V> },
	};
}

export async function cancel(caller: LedgerCaller, id: string) {
	await readJob(caller, id);
	await new ImportQueueService(caller.db).cancelJob(
		caller.principal.userId,
		id,
	);
	return toDto(await readJob(caller, id));
}

export async function remove(caller: LedgerCaller, id: string) {
	await readJob(caller, id);
	await new ImportQueueService(caller.db).deleteJob(
		caller.principal.userId,
		id,
	);
	return { ok: true as const };
}
