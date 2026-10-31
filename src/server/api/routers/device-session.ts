import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
	endOwnSession,
	listOwnSessions,
} from "~/server/services/account-security.service";

/**
 * The devices the user is signed in on: every live session, whether it is a
 * browser, the phone app or a device approved at /device. Settings lists
 * them and signs the others out, by session id. better-auth's listSessions
 * is no use for this: it wants a session younger than a day and returns
 * every session token, the web cookie's too, to page script. No token ever
 * leaves this router.
 *
 * (It used to list only the /device sessions, so a person signed in on the
 * web and the phone saw "no approved devices".)
 */
export const deviceSessionRouter = createTRPCRouter({
	list: protectedProcedure.query(async ({ ctx }) =>
		listOwnSessions(ctx.session.user.id, ctx.session.session.id),
	),

	/** Signs another device out: its token stops working on the next request. */
	disconnect: protectedProcedure
		.input(z.object({ id: z.string().min(1).max(64) }))
		.mutation(async ({ ctx, input }) => {
			await endOwnSession(
				ctx.session.user.id,
				ctx.session.session.id,
				input.id,
			);
			return { id: input.id };
		}),
});
