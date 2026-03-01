import { env } from "~/env";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const systemRouter = createTRPCRouter({
	getServerTime: protectedProcedure.query(async () => {
		// Return server's current time for consistent timezone handling across client and server
		return { serverTime: new Date() };
	}),

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

	checkImporterStatus: protectedProcedure.query(async () => {
		if (!env.IMPORTER_URL) {
			return { available: false };
		}

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout

			const response = await fetch(`${env.IMPORTER_URL}/health`, {
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				return { available: false };
			}

			const data = (await response.json()) as {
				status: string;
				uptime_seconds: number;
				version: string;
			};

			return {
				available: data.status === "ok",
				uptime: data.uptime_seconds,
				version: data.version,
			};
		} catch (error) {
			console.error("Importer health check failed:", error);
			return { available: false };
		}
	}),
});
