import { TRPCError } from "@trpc/server";
import { InMemoryRateLimiter } from "~/server/lib/rate-limiter";
import { logEventAsync } from "./audit.service";

const limiter = new InMemoryRateLimiter();

/**
 * A test email is real mail from the server: 3 a minute per admin, and each
 * one is written to the audit log.
 */
export function guardTestEmail(adminId: string, emailType: string): void {
	if (!limiter.check(`adminTestEmail_${adminId}`, 3, 60_000)) {
		throw new TRPCError({
			code: "TOO_MANY_REQUESTS",
			message: "Too many test emails. Try again in a minute.",
		});
	}
	logEventAsync({
		eventType: "SETTINGS_UPDATED",
		userId: adminId,
		metadata: { action: "admin_test_email", adminId, emailType },
	});
}
