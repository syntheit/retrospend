import { TRPCError } from "@trpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({ env: { WORKER_API_KEY: "key" } }));

import { IntegrationError } from "../integration-error";
import { IntegrationService } from "../integration.service";

afterEach(() => vi.unstubAllGlobals());

describe("IntegrationService.request", () => {
	it("keeps the answer's status on the error it throws, for callers that branch on it", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response("Backup already in progress", { status: 409 }),
			),
		);
		const error = await IntegrationService.requestWorker(
			"http://sidecar:8080/backups/run",
			{ method: "POST" },
		).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(TRPCError);
		expect((error as TRPCError).code).toBe("BAD_GATEWAY");
		expect((error as TRPCError).cause).toBeInstanceOf(IntegrationError);
		expect(((error as TRPCError).cause as IntegrationError).status).toBe(409);
	});
});
