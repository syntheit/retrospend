import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const userRouter = createTRPCRouter({
	deleteAccount: protectedProcedure.mutation(async ({ ctx }) => {
		const { session, db } = ctx;

		await db.user.delete({
			where: { id: session.user.id },
		});

		return { success: true };
	}),
});
