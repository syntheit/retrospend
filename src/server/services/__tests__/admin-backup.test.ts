import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
	SIDECAR_URL: "http://sidecar:8080",
	WORKER_API_KEY: "key" as string | undefined,
}));
vi.mock("~/env", () => ({ env }));
const requestWorker = vi.hoisted(() => vi.fn());
vi.mock("~/server/services/integration.service", async () => ({
	...(await vi.importActual<object>("~/server/services/integration.service")),
	IntegrationService: { requestWorker },
}));

import { AdminFailureError } from "../admin-failure";
import { requestBackup } from "../admin-backup";
import { IntegrationError } from "../integration-error";

const refused = (status: number) =>
	new TRPCError({
		code: "BAD_GATEWAY",
		message: "External API request failed: /var/lib/backups is full",
		cause: new IntegrationError("x", status),
	});

async function problemOf(promise: Promise<unknown>) {
	const error = await promise.then(
		() => null,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(AdminFailureError);
	return (error as AdminFailureError).problem;
}

describe("requestBackup", () => {
	beforeEach(() => {
		env.WORKER_API_KEY = "key";
		requestWorker.mockReset();
	});

	it("returns what the sidecar accepted", async () => {
		requestWorker.mockResolvedValue(
			new Response(JSON.stringify({ status: "accepted" })),
		);
		await expect(requestBackup()).resolves.toEqual({ status: "accepted" });
		expect(requestWorker).toHaveBeenCalledWith(
			"http://sidecar:8080/backups/run",
			{ method: "POST", timeout: 300000 },
		);
	});

	it("is unavailable without a worker key", async () => {
		env.WORKER_API_KEY = undefined;
		expect(await problemOf(requestBackup())).toBe("backup_unavailable");
		expect(requestWorker).not.toHaveBeenCalled();
	});

	it("is unavailable when the sidecar does not answer", async () => {
		requestWorker.mockRejectedValue(
			new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "fetch failed" }),
		);
		expect(await problemOf(requestBackup())).toBe("backup_unavailable");
	});

	it("is running when the sidecar answers 409", async () => {
		requestWorker.mockRejectedValue(refused(409));
		expect(await problemOf(requestBackup())).toBe("backup_running");
	});

	it("failed when the sidecar answers with another error or is too slow", async () => {
		requestWorker.mockRejectedValueOnce(refused(500));
		expect(await problemOf(requestBackup())).toBe("backup_failed");
		requestWorker.mockRejectedValueOnce(
			new TRPCError({ code: "TIMEOUT", message: "timed out: http://sidecar" }),
		);
		expect(await problemOf(requestBackup())).toBe("backup_failed");
	});

	it("says nothing the sidecar said", async () => {
		requestWorker.mockRejectedValue(refused(500));
		const error = (await requestBackup().catch((e: unknown) => e)) as Error;
		expect(error.message).not.toContain("/var/lib");
		expect(error.cause).toBeUndefined();
	});

	it("passes an error it does not know as it is", async () => {
		const bug = new Error("boom");
		requestWorker.mockRejectedValue(bug);
		await expect(requestBackup()).rejects.toBe(bug);
	});
});
