import {
	DEVICE_CLIENT_IDS,
	parseScopeList,
} from "@retrospend/api-contract/common";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/**
 * The devices a user approved at /device (RFC 8628): their sessions stamped
 * with a device client id. Settings lists and disconnects them here, by
 * session id. better-auth's listSessions is no use for this: it wants a
 * session younger than a day and returns every session token, the web
 * cookie's too, to page script. No token ever leaves this router.
 */
const deviceWhere = (userId: string) => ({
	userId,
	clientId: { in: [...DEVICE_CLIENT_IDS] },
});

export const deviceSessionRouter = createTRPCRouter({
	list: protectedProcedure.query(async ({ ctx }) => {
		const rows = await ctx.db.session.findMany({
			where: {
				...deviceWhere(ctx.session.user.id),
				expiresAt: { gt: new Date() },
			},
			select: {
				id: true,
				clientId: true,
				scopes: true,
				createdAt: true,
				updatedAt: true,
			},
			orderBy: { createdAt: "desc" },
		});
		return rows.map((r) => ({
			id: r.id,
			clientId: r.clientId ?? "",
			scopes: parseScopeList(r.scopes).scopes,
			approvedAt: r.createdAt,
			lastUsedAt: r.updatedAt,
		}));
	}),

	/** Signs the device out: its token stops working on the next request. */
	disconnect: protectedProcedure
		.input(z.object({ id: z.string().min(1).max(64) }))
		.mutation(async ({ ctx, input }) => {
			const { count } = await ctx.db.session.deleteMany({
				where: { id: input.id, ...deviceWhere(ctx.session.user.id) },
			});
			if (count === 0) throw new TRPCError({ code: "NOT_FOUND" });
			return { id: input.id };
		}),
});
