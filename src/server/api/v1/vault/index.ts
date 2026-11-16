import {
	pullVaultChanges,
	writeVaultRecords,
} from "~/server/services/vault/vault-api.service";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";
import { enforceRateLimit } from "../rate-limit";

const v = v1.vault;

/**
 * Batches one account may push per minute. A client pushes a few at a time
 * (turn-on upload resumes in 500-write batches), and each batch holds a
 * transaction for up to the write timeout, so this bounds the work one
 * account can queue on the database without slowing a normal sync.
 */
export const VAULT_WRITE_LIMIT = { limit: 30, windowMs: 60_000 } as const;

export const vaultRouter = {
	changes: v.changes.handler(
		serve(({ context, input }) => {
			const { db, principal } = signedIn(context);
			return pullVaultChanges(db, principal.userId, input);
		}),
	),
	writes: v.writes.handler(
		serve(async ({ context, input }) => {
			const { db, principal } = signedIn(context);
			await enforceRateLimit(
				`vault-writes:${principal.userId}`,
				VAULT_WRITE_LIMIT,
				context.resHeaders,
			);
			return {
				results: await writeVaultRecords(db, principal.userId, input.writes),
			};
		}),
	),
};
