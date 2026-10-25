import {
	API_PREFIX,
	type CursorQuery,
	EXPORT_RETENTION_MS,
	type ExportJobDto,
	type ExportRequest,
} from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import { deleteFile, getFileStream } from "~/server/storage";
import type { ExportJobStatus, Prisma } from "~prisma";
import type { Caller } from "./caller";
import { decodeCursor, toPage } from "./cursor";
import { checkExportLink, signExportLink } from "./export-link";
import { runExportJob } from "./export-run";

/**
 * v1 adapters for /exports. A request becomes an `export_job` row and runs
 * in the background (export-run.ts); the row says where it stands and the
 * file waits in the upload store for 24 hours. Every read goes through the
 * caller's user-scoped client, so another user's job is a 404, not a 403.
 */

const MAX_ACTIVE = 3;

/** A job that has not finished by now was lost with its process. */
const STALE_MS = 15 * 60 * 1000;

const FORMATS = {
	data: "zip",
	project_pdf: "pdf",
	person_pdf: "pdf",
} as const;

function formatOf(kind: ExportRequest["kind"]): ExportJobDto["format"] {
	return FORMATS[kind as keyof typeof FORMATS] ?? "csv";
}

type JobRow = Prisma.ExportJobGetPayload<object>;

function stateOf(row: JobRow, now: Date): ExportJobDto["state"] {
	const status: ExportJobStatus = row.status;
	if (status === "FAILED") return "failed";
	if (status === "READY")
		return row.expiresAt.getTime() <= now.getTime() ? "expired" : "ready";
	const since = (row.startedAt ?? row.createdAt).getTime();
	if (now.getTime() - since > STALE_MS) return "failed";
	return status === "RUNNING" ? "running" : "queued";
}

function toDto(row: JobRow, now = new Date()): ExportJobDto {
	const state = stateOf(row, now);
	const link =
		state === "ready" ? signExportLink(row.id, row.userId, now.getTime()) : null;
	return {
		id: row.id,
		kind: row.kind as ExportJobDto["kind"],
		format: formatOf(row.kind as ExportRequest["kind"]),
		state,
		fileName: state === "ready" ? row.fileName : null,
		sizeBytes: state === "ready" ? row.sizeBytes : null,
		error:
			state === "failed"
				? (row.error ?? "The export did not finish")
				: null,
		createdAt: row.createdAt.toISOString(),
		completedAt: row.completedAt?.toISOString() ?? null,
		expiresAt: row.expiresAt.toISOString(),
		download: link
			? {
					url: `${API_PREFIX}/exports/jobs/${row.id}/download?token=${link.token}`,
					expiresAt: link.expiresAt.toISOString(),
				}
			: null,
	};
}

const notFound = () =>
	new TRPCError({ code: "NOT_FOUND", message: "Export not found" });

async function readJob(caller: Caller, id: string): Promise<JobRow> {
	const row = await caller.db.exportJob.findFirst({
		where: { id, userId: caller.principal.userId },
	});
	if (!row) throw notFound();
	return row;
}

/** Deletes this user's expired files and rows; a failure never blocks the request. */
async function purgeExpired(caller: Caller) {
	const expired = await caller.db.exportJob.findMany({
		where: { userId: caller.principal.userId, expiresAt: { lt: new Date() } },
		select: { id: true, storagePath: true },
	});
	for (const job of expired) {
		if (job.storagePath) await deleteFile(job.storagePath).catch(() => {});
	}
	if (expired.length > 0)
		await caller.db.exportJob.deleteMany({
			where: { id: { in: expired.map((j) => j.id) } },
		});
}

export async function requestExport(
	caller: Caller & { timeZone: string },
	input: ExportRequest,
) {
	const userId = caller.principal.userId;
	await purgeExpired(caller).catch(() => {});
	const fresh = new Date(Date.now() - STALE_MS);
	const active = await caller.db.exportJob.count({
		where: {
			userId,
			OR: [
				{ status: "QUEUED", createdAt: { gt: fresh } },
				{ status: "RUNNING", startedAt: { gt: fresh } },
			],
		},
	});
	if (active >= MAX_ACTIVE)
		throw new TRPCError({
			code: "CONFLICT",
			message: `At most ${MAX_ACTIVE} exports can wait or run at a time`,
		});

	const { kind, ...params } = input;
	const row = await caller.db.exportJob.create({
		data: {
			userId,
			kind,
			params,
			timeZone: caller.timeZone,
			expiresAt: new Date(Date.now() + EXPORT_RETENTION_MS),
		},
	});
	// The request is answered now; the document is built after it.
	void runExportJob(row.id, userId).catch((error) => {
		console.error(`Export ${row.id} could not be recorded`, error);
	});
	return toDto(row);
}

const createdCursor = z.object({ createdAt: z.iso.datetime(), id: z.string() });

export async function listJobs(caller: Caller, q: CursorQuery) {
	const after = decodeCursor(q.cursor, createdCursor);
	const rows = await caller.db.exportJob.findMany({
		where: {
			userId: caller.principal.userId,
			expiresAt: { gt: new Date() },
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
	});
	const now = new Date();
	return toPage(
		rows,
		q.limit,
		(r) => ({ createdAt: r.createdAt.toISOString(), id: r.id }),
		(r) => toDto(r, now),
	);
}

export async function getJob(caller: Caller, id: string) {
	return toDto(await readJob(caller, id));
}

export async function deleteJob(caller: Caller, id: string) {
	const row = await readJob(caller, id);
	if (row.storagePath) await deleteFile(row.storagePath).catch(() => {});
	await caller.db.exportJob.deleteMany({
		where: { id, userId: caller.principal.userId },
	});
	return { ok: true as const };
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

/** The finished file, for the job's owner with a link that is still valid. */
export async function downloadFile(
	caller: Caller,
	input: { id: string; token: string },
): Promise<File> {
	const userId = caller.principal.userId;
	// The job first, so another user's id is a 404 whatever the token says.
	const row = await readJob(caller, input.id);
	const check = checkExportLink(row.id, userId, input.token);
	if (check !== "ok")
		throw new TRPCError({
			code: "FORBIDDEN",
			message:
				check === "expired"
					? "This download link expired. Read the export job again for a new one"
					: "This download link is not valid",
		});
	if (stateOf(row, new Date()) !== "ready" || !row.storagePath || !row.fileName)
		throw notFound();
	const bytes = await readAll(await getFileStream(row.storagePath).catch(() => {
		throw notFound();
	}));
	return new File([new Uint8Array(bytes)], row.fileName, {
		type: row.contentType ?? "application/octet-stream",
	});
}
