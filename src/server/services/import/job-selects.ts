/**
 * What the import queue reads and returns of a job, and the text it keeps for
 * a failure (E2EE D11 Revision 3, PR 5).
 */
import {
	SealedTextError,
	stripUserTextControls,
} from "@retrospend/api-contract/common";
import { FieldCryptoError } from "~/server/crypto/field-crypto";
import { textUnavailableProblem } from "~/server/crypto/field-open";
import type { ImportJobStatus, Prisma, PrismaClient } from "~prisma";

const MAX_ERROR_LENGTH = 1000;

/**
 * Every read, create and update of a job names its columns or omits the file
 * (src/test/importJobSelects.test.ts): `fileData` is up to 14 MB, sealed at rest, and
 * only processQueue reads it.
 */
export const NO_FILE = { fileData: true } as const;
/**
 * What a check before a write or delete reads, and what a status write
 * returns: no mapped column, so a job whose owner's key is gone can still be
 * cancelled or deleted, and a write that committed is never turned into an
 * error by opening a cell afterwards.
 */
export const GUARD = { userId: true, status: true } as const;
export const STATE = { id: true, status: true } as const;
/** What createJob returns: the job's id and state, never its file or text. */
export const JOB_CREATED = {
	id: true,
	status: true,
	type: true,
	createdAt: true,
} as const;

/**
 * A failure's text for the job. The message can quote a row of the file, so
 * it is cleaned like imported text, after the cap (which can split a pair);
 * one that starts with the sealed marker is not stored.
 */
export function errorText(error: unknown): string {
	const message = error instanceof Error ? error.message : "Unknown error";
	try {
		return stripUserTextControls(message.substring(0, MAX_ERROR_LENGTH));
	} catch (e) {
		if (e instanceof SealedTextError) return "Unknown error";
		throw e;
	}
}

/**
 * A write that discards its row. A returned row is opened, and the rows,
 * warnings, file and error text are sealed, so only `id` comes back.
 *
 * With `only`, the row is written only while it is in one of those statuses,
 * and false says it was not: the sweep (retention-sweep.ts) fails a job that
 * waited or ran too long and clears its file, and a late write of the run
 * must not bring that job back.
 */
export async function writeJob(
	db: PrismaClient | Prisma.TransactionClient,
	id: string,
	data: Prisma.ImportJobUpdateInput,
	only?: ImportJobStatus | ImportJobStatus[],
): Promise<boolean> {
	try {
		await db.importJob.update({
			where: {
				id,
				...(only && { status: Array.isArray(only) ? { in: only } : only }),
			},
			select: { id: true },
			data,
		});
		return true;
	} catch (error) {
		if (only && (error as { code?: string }).code === "P2025") return false;
		throw error;
	}
}

/** A sealed cell that cannot be read: its key is gone, or the value is damaged. */
export const isUnreadableText = (error: unknown) =>
	textUnavailableProblem(error) !== null || error instanceof FieldCryptoError;

/**
 * The next QUEUED job of a user, with its file: the one place the file is
 * read. When the file cannot be opened (the owner's key is gone, or the cell
 * is damaged) it never will be, so that job fails at once with no reason text
 * (the code is logged, never the text) and "failed" says to look again,
 * instead of leaving it queued until the sweep.
 */
export async function nextQueuedJob(
	db: PrismaClient | Prisma.TransactionClient,
	userId: string,
) {
	const where = { userId, status: "QUEUED" } as const;
	const orderBy = { createdAt: "asc" } as const;
	try {
		return await db.importJob.findFirst({
			where,
			orderBy,
			select: {
				id: true,
				userId: true,
				type: true,
				fileName: true,
				fileType: true,
				fileData: true,
			},
		});
	} catch (error) {
		if (!isUnreadableText(error)) throw error;
		console.error("An import file could not be opened, failing the job", {
			code: (error as { code?: string }).code,
		});
		const stuck = await db.importJob.findFirst({
			where,
			orderBy,
			select: { id: true },
		});
		if (stuck)
			await writeJob(
				db,
				stuck.id,
				{ status: "FAILED", failedAt: new Date(), fileData: null },
				"QUEUED",
			);
		return "failed" as const;
	}
}
