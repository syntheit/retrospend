import * as account from "~/server/services/api-v1/account";
import * as gap from "~/server/services/api-v1/gap-reads";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";
import { enforceRateLimit } from "../rate-limit";

const p = v1.account;

/**
 * Wrong passwords are the one thing here an attacker with a stolen session
 * can try, so tries are counted per user, right ones included: five in 15
 * minutes, whatever token they come from.
 */
const DELETE_TRIES = { limit: 5, windowMs: 15 * 60_000 } as const;

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
			const user = signedIn(context);
			await enforceRateLimit(
				`acctdel:${user.principal.userId}`,
				DELETE_TRIES,
				context.resHeaders,
			);
			return account.deleteAccount(user, input.password);
		}),
	),
};
