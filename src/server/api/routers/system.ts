import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const systemRouter = createTRPCRouter({
	getWorkerStatus: protectedProcedure.query(async ({ ctx }) => {
		const { db } = ctx;

		// Fetch the latest heartbeat
		const status = await db.systemStatus.findUnique({
			where: { key: "worker_heartbeat" },
		});

		if (!status) return null;

		return status.value as {
			lastRun: string;
			success: boolean;
			task: string;
		};
	}),
});
