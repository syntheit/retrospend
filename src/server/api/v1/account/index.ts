import * as account from "~/server/services/api-v1/account";
import * as gap from "~/server/services/api-v1/gap-reads";
import { DeleteTriesExceededError } from "~/server/services/account-deletion.service";
import { serve } from "../core/serve";
import { problem } from "../errors";
import { signedIn, v1 } from "../middleware";

const p = v1.account;

export const accountRouter = {
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
					context.resHeaders?.set("Retry-After", String(error.retryAfterSeconds));
					throw problem("rate_limited", undefined, {
						retryAfter: error.retryAfterSeconds,
					});
				}
				throw error;
			}
		}),
	),
};
