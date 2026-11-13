/**
 * What the import queue reads and returns of a job, and the text it keeps for
 * a failure (E2EE D11 Revision 3, PR 5).
 */
import {
	SealedTextError,
	stripUserTextControls,
} from "@retrospend/api-contract/common";
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
