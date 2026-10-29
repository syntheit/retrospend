/**
 * What every envelope procedure shares (envelope.ts, envelope-money.ts):
 * signed in, the flag on, domain errors mapped to tRPC codes in one place,
 * and money writes as preview (rolled back) and apply (committed) of the
 * same mutation (R30).
 */
import { TRPCError } from "@trpc/server";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";
import {
	applyOutputSchema,
	movementResultSchema,
	previewOutputSchema,
} from "~/lib/schemas/envelope";
import { protectedProcedure } from "~/server/api/trpc";
import {
	EnvelopeError,
	type EnvelopeErrorCode,
} from "~/server/services/envelope/errors";
import { forUser, type MoneyMutation } from "~/server/services/preview";

const CODES: Record<EnvelopeErrorCode, TRPC_ERROR_CODE_KEY> = {
	NO_BOOK: "NOT_FOUND",
	BOOK_EXISTS: "CONFLICT",
	MONTH_CLOSED: "BAD_REQUEST",
	OVER_CAP: "BAD_REQUEST",
	INVALID: "BAD_REQUEST",
	NOT_FOUND: "NOT_FOUND",
	ID_REUSED: "CONFLICT",
	ALREADY_UNDONE: "CONFLICT",
	DRAFT_OPEN: "CONFLICT",
};

/** Signed in; domain errors leave as tRPC codes in one place. */
export const envelopeProcedure = protectedProcedure.use(
	async ({ ctx, next }) => {
		const result = await next();
		if (!result.ok && result.error.cause instanceof EnvelopeError) {
			throw new TRPCError({
				code: CODES[result.error.cause.code],
				message: result.error.cause.message,
				cause: result.error.cause,
			});
		}
		return result;
	},
);

export const movementPreview = previewOutputSchema(movementResultSchema);
export const movementApply = applyOutputSchema(movementResultSchema);

type Ctx = { ctx: { session: { user: { id: string } } } };

/** A money write rolled back (R30): what it would change. */
export const preview =
	<I, V>(mutation: MoneyMutation<I, V>) =>
	({ ctx, input }: Ctx & { input: I }) =>
		forUser(ctx.session.user.id).preview(mutation, input);

/** The same write committed, with its undo token. */
export const apply =
	<I, V>(mutation: MoneyMutation<I, V>) =>
	({ ctx, input }: Ctx & { input: I }) =>
		forUser(ctx.session.user.id).apply(mutation, input);
