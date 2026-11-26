import { z } from "zod";
import { templateIdSchema } from "~/lib/schemas/recurring";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { restoreTokenSchema } from "~/server/services/entry/input";
import {
	deleteTemplate,
	previewDeleteTemplate,
	previewRestoreTemplate,
	restoreTemplate,
} from "~/server/services/recurring-delete-web.service";

const deleteInput = z.object({ id: templateIdSchema });

/**
 * Delete a template and take it back (R30), merged into the `recurring`
 * namespace in root.ts. Each is a preview and save pair of the mutation
 * /api/v1 runs (recurring-delete.mutation.ts): `delete.save` answers with a
 * `restore` token, and `restore.save` with that token puts the template back.
 */
export const recurringDeleteRouter = createTRPCRouter({
	delete: createTRPCRouter({
		preview: protectedProcedure
			.input(deleteInput)
			.mutation(({ ctx, input }) =>
				previewDeleteTemplate(ctx.db, ctx.session.user.id, input.id),
			),
		save: protectedProcedure
			.input(deleteInput)
			.mutation(({ ctx, input }) =>
				deleteTemplate(ctx.db, ctx.session.user.id, input.id),
			),
	}),
	restore: createTRPCRouter({
		preview: protectedProcedure
			.input(restoreTokenSchema)
			.mutation(({ ctx, input }) =>
				previewRestoreTemplate(ctx.session.user.id, input.token),
			),
		save: protectedProcedure
			.input(restoreTokenSchema)
			.mutation(({ ctx, input }) =>
				restoreTemplate(ctx.db, ctx.session.user.id, input.token),
			),
	}),
});
