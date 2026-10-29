import { errorCode } from "~/features/project/errors";

/**
 * The id a plan save goes under: the open draft's, else a new one. A saved
 * (applied) plan is never edited in place, since the server refuses its id;
 * a new draft starts from its lines instead.
 */
export function planSaveId(
	drafts: { open: { id: string } | null } | undefined,
	newId: () => string,
): string {
	return drafts?.open?.id ?? newId();
}

/**
 * The server refused the save because the plan moved on (another plan was
 * opened for the month on another device): read it again before a retry.
 */
export function isPlanConflict(error: unknown): boolean {
	return errorCode(error) === "CONFLICT";
}
