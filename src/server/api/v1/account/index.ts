import { DeleteTriesExceededError } from "~/server/services/account-deletion.service";
import { PasswordTriesExceededError } from "~/server/services/account-security.service";
import * as account from "~/server/services/api-v1/account";
import * as gap from "~/server/services/api-v1/gap-reads";
import { serve } from "../core/serve";
import { problem } from "../errors";
import { signedIn, v1 } from "../middleware";

const p = v1.account;

export const accountRouter = {
	changePassword: p.changePassword.handler(
		serve(async ({ context, input }) => {
			try {
				return await account.changePassword(signedIn(context), input);
			} catch (error) {
				// The service counts the tries (the web has the same limit): a 429 here.
				if (error instanceof PasswordTriesExceededError) {
					context.resHeaders?.set(
						"Retry-After",
						String(error.retryAfterSeconds),
					);
					throw problem("rate_limited", undefined, {
						retryAfter: error.retryAfterSeconds,
					});
				}
				throw error;
			}
		}),
	),
	sessions: p.sessions.handler(
		serve(({ context }) => account.readSessions(signedIn(context))),
	),
	endSession: p.endSession.handler(
		serve(({ context, input }) =>
			account.endSession(signedIn(context), input.id),
		),
	),
	recordConsent: p.recordConsent.handler(
		serve(({ context, input }) =>
			gap.recordConsent(
				signedIn(context),
				context.headers,
				input.consentVersion,
			),
		),
	),
	deletionPreview: p.deletionPreview.handler(
		serve(({ context }) => account.readAccountDeletion(signedIn(context))),
	),
	delete: p.delete.handler(
		serve(async ({ context, input }) => {
			try {
				return await account.deleteAccount(signedIn(context), input.password);
			} catch (error) {
				// The service counts the tries (the web has the same limit): a 429 here.
				if (error instanceof DeleteTriesExceededError) {
					context.resHeaders?.set(
						"Retry-After",
						String(error.retryAfterSeconds),
					);
					throw problem("rate_limited", undefined, {
						retryAfter: error.retryAfterSeconds,
					});
				}
				throw error;
			}
		}),
	),
};
