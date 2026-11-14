/**
 * Domain errors of the envelope services (build plan 02 §5.1). Services know
 * nothing about tRPC; the router maps `code` to a transport status in one
 * place, and /api/v1 maps the same codes to problem+json.
 */
import type { Minor } from "./types";

export type EnvelopeErrorCode =
	| "NO_BOOK"
	| "BOOK_EXISTS"
	| "MONTH_CLOSED"
	| "OVER_CAP"
	| "INVALID"
	| "NOT_FOUND"
	| "ID_REUSED"
	| "ALREADY_UNDONE"
	/** A new plan while another plan is open for its month. */
	| "DRAFT_OPEN";

export class EnvelopeError extends Error {
	constructor(
		readonly code: EnvelopeErrorCode,
		message: string,
		/** OVER_CAP: the most the source envelope holds (S15). */
		readonly availableMinor?: Minor,
	) {
		super(message);
		this.name = "EnvelopeError";
	}
}
