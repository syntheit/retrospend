import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { listOwnAdminAccess } from "~/server/services/admin-access.service";

/** What admins have done to the signed-in person's account (Settings, Security). */
export const adminAccessRouter = createTRPCRouter({
	list: protectedProcedure.query(({ ctx }) => listOwnAdminAccess(ctx.db)),
});
