import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
	SIDECAR_URL: "http://sidecar:8080",
	WORKER_API_KEY: "key" as string | undefined,
}));
vi.mock("~/env", () => ({ env }));
vi.mock("~/server/db", () => ({ db: {} }));
const requestWorker = vi.hoisted(() => vi.fn());
vi.mock("~/server/services/integration.service", () => ({
	IntegrationService: { requestWorker },
}));

import { RateSyncUnavailable, requestRateSync } from "../exchange-rate.service";

// Staging runs without the sidecar: Sync now must say it cannot sync here,
// not fail. A sidecar that answers with an error still fails.
describe("requestRateSync", () => {
	beforeEach(() => {
		env.WORKER_API_KEY = "key";
		requestWorker.mockReset();
	});

	it("asks the sidecar to sync", async () => {
		requestWorker.mockResolvedValue(new Response("ok"));
		await requestRateSync();
		expect(requestWorker).toHaveBeenCalledWith(
			"http://sidecar:8080/sync-rates",
			// /sync-rates answers after it fetched: a long timeout, not the 5 s default.
			{ method: "POST", timeout: 120_000 },
		);
	});

	it("is unavailable without a worker key", async () => {
		env.WORKER_API_KEY = undefined;
		await expect(requestRateSync()).rejects.toBeInstanceOf(RateSyncUnavailable);
		expect(requestWorker).not.toHaveBeenCalled();
	});

	it("is unavailable when the sidecar does not answer", async () => {
		requestWorker.mockRejectedValueOnce(
			new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "fetch failed" }),
		);
		await expect(requestRateSync()).rejects.toBeInstanceOf(RateSyncUnavailable);
	});

	it("fails when the sidecar is too slow", async () => {
		const slow = new TRPCError({ code: "TIMEOUT", message: "timed out" });
		requestWorker.mockRejectedValueOnce(slow);
		await expect(requestRateSync()).rejects.toBe(slow);
	});

	it("fails when the sidecar answers with an error", async () => {
		const refused = new TRPCError({ code: "BAD_GATEWAY", message: "500" });
		requestWorker.mockRejectedValue(refused);
		await expect(requestRateSync()).rejects.toBe(refused);
	});
});
