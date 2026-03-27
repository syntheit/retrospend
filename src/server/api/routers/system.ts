import { env } from "~/env";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { getAppSettings } from "~/server/services/settings";

// ── Sidecar health check cache ──────────────────────────────────────────
type SidecarStatus = { online: boolean; importerAvailable: boolean; uptime?: number; version?: string };
let sidecarCache: { data: SidecarStatus; expiry: number } | null = null;
const SIDECAR_CACHE_TTL_MS = 30_000; // 30 seconds
const SIDECAR_ERROR_TTL_MS = 10_000; // 10 seconds for error results

export const systemRouter = createTRPCRouter({
	getFeatureFlags: publicProcedure.query(async () => {
		const settings = await getAppSettings();
		return {
			feedbackEnabled: settings.enableFeedback,
		};
	}),

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

	checkSidecarStatus: protectedProcedure.query(async () => {
		if (sidecarCache && Date.now() < sidecarCache.expiry) {
			return sidecarCache.data;
		}

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout

			const response = await fetch(`${env.SIDECAR_URL}/health`, {
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				const result: SidecarStatus = { online: false, importerAvailable: false };
				sidecarCache = { data: result, expiry: Date.now() + SIDECAR_ERROR_TTL_MS };
				return result;
			}

			const data = (await response.json()) as {
				status: string;
				uptime_seconds: number;
				version: string;
				importer_available: boolean;
			};

			const result: SidecarStatus = {
				online: true,
				importerAvailable: data.importer_available ?? false,
				uptime: data.uptime_seconds,
				version: data.version,
			};
			sidecarCache = { data: result, expiry: Date.now() + SIDECAR_CACHE_TTL_MS };
			return result;
		} catch (error) {
			console.error("Sidecar health check failed:", error);
			const result: SidecarStatus = { online: false, importerAvailable: false };
			sidecarCache = { data: result, expiry: Date.now() + SIDECAR_ERROR_TTL_MS };
			return result;
		}
	}),

	/** @deprecated Use checkSidecarStatus instead */
	checkImporterStatus: protectedProcedure.query(async () => {
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 2000);

			const response = await fetch(`${env.SIDECAR_URL}/health`, {
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				return { available: false };
			}

			const data = (await response.json()) as {
				importer_available: boolean;
				uptime_seconds: number;
				version: string;
			};

			return {
				available: data.importer_available ?? false,
				uptime: data.uptime_seconds,
				version: data.version,
			};
		} catch {
			return { available: false };
		}
	}),
});
