import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { isInviteOnlyEnabled } from "~/server/services/settings";

export const settingsRouter = createTRPCRouter({
	getInviteOnlyEnabled: publicProcedure.query(async () => {
		const inviteOnlyEnabled = await isInviteOnlyEnabled();
		return {
			inviteOnlyEnabled,
		};
	}),
});
