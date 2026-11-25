import type { AdminFailureCode } from "@retrospend/api-contract/common";
import { TRPCError } from "@trpc/server";
import { IntegrationError } from "./integration-error";

/**
 * Each failure an admin action can name: the sentence API v1 sends as the
 * problem's detail, and the tRPC code it travels under. The web words it from
 * its own catalog by `problem`; no error text from the mail server or the
 * sidecar (hostnames, usernames, SMTP replies) ever goes into one of these.
 */
const FAILURES: Record<
	AdminFailureCode,
	{ trpc: "CONFLICT" | "BAD_GATEWAY" | "GATEWAY_TIMEOUT"; message: string }
> = {
	email_not_configured: {
		trpc: "CONFLICT",
		message: "Email is not set up on this server.",
	},
	email_auth_failed: {
		trpc: "BAD_GATEWAY",
		message: "The email server refused the sign-in.",
	},
	email_unreachable: {
		trpc: "BAD_GATEWAY",
		message: "The email server could not be reached.",
	},
	email_timeout: {
		trpc: "GATEWAY_TIMEOUT",
		message: "The email server took too long to answer.",
	},
	backup_running: { trpc: "CONFLICT", message: "A backup is already running." },
	backup_unavailable: {
		trpc: "BAD_GATEWAY",
		message: "The backup service is not available.",
	},
	backup_failed: {
		trpc: "BAD_GATEWAY",
		message: "The backup could not start.",
	},
	rate_sync_failed: {
		trpc: "BAD_GATEWAY",
		message: "Rates could not be synced.",
	},
};

/**
 * A known failure of an admin action. On the web `data.problem` carries the
 * code; API v1 answers it as the problem of the same name.
 */
export class AdminFailureError extends TRPCError {
	readonly problem: AdminFailureCode;

	constructor(problem: AdminFailureCode) {
		super({
			code: FAILURES[problem].trpc,
			message: FAILURES[problem].message,
		});
		this.name = "AdminFailureError";
		this.problem = problem;
	}
}

/** Nodemailer's error codes (the SMTP reply text is never read) and what they mean. */
const SMTP_CODES: Record<string, AdminFailureCode> = {
	EAUTH: "email_auth_failed",
	ECONNECTION: "email_unreachable",
	ESOCKET: "email_unreachable",
	EDNS: "email_unreachable",
	ETIMEDOUT: "email_timeout",
};

/** The known failure behind a mail send error, or null for one this does not name. */
export function smtpFailure(error: unknown): AdminFailureError | null {
	const code = (error as { code?: unknown } | null)?.code;
	const problem = typeof code === "string" ? SMTP_CODES[code] : undefined;
	return problem ? new AdminFailureError(problem) : null;
}

/** How a request to the sidecar went wrong, as IntegrationService reports it. */
export type WorkerFailure =
	| { kind: "no-answer" }
	| { kind: "refused"; status: number | undefined }
	| { kind: "timeout" };

/**
 * IntegrationService turns a sidecar that never answered into
 * INTERNAL_SERVER_ERROR, one that answered with an error into BAD_GATEWAY
 * (the answer's status on its cause) and a slow one into TIMEOUT. Anything
 * else is not the sidecar's doing and stays unclassified.
 */
export function workerFailure(error: unknown): WorkerFailure | null {
	if (!(error instanceof TRPCError)) return null;
	if (error.code === "INTERNAL_SERVER_ERROR") return { kind: "no-answer" };
	if (error.code === "TIMEOUT") return { kind: "timeout" };
	if (error.code === "BAD_GATEWAY")
		return {
			kind: "refused",
			status:
				error.cause instanceof IntegrationError ? error.cause.status : undefined,
		};
	return null;
}
