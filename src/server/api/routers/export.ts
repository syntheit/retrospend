import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { ExportService } from "~/server/services/export.service";

export const exportRouter = createTRPCRouter({
	allData: protectedProcedure.mutation(async ({ ctx }) => {
		const exportService = new ExportService(ctx.db);
		return await exportService.exportAllData(ctx.session.user.id);
	}),
});
