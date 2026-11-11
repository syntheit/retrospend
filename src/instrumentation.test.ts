import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const gate = vi.hoisted(() => ({ error: undefined as Error | undefined }));
const step = (name: string) => () => {
	calls.push(name);
};

vi.mock("~/server/crypto/master-key", () => ({
	assertMasterKeyConfig: step("master key config"),
}));
vi.mock("~/server/services/keys/master-canary.service", () => ({
	assertMasterKeyCanary: async () => step("canary")(),
}));
vi.mock("~/server/services/keys/field-encryption-start", () => ({
	assertFieldEncryptionStart: async () => {
		calls.push("field encryption");
		if (gate.error) throw gate.error;
	},
}));
vi.mock("~/server/services/webhooks/worker", () => ({
	startWebhookWorker: step("worker"),
}));
vi.mock("~/server/services/push/worker", () => ({
	startPushWorker: step("worker"),
}));
vi.mock("~/server/services/api-v1/export-sweep", () => ({
	startExportSweep: step("worker"),
}));
vi.mock("~/server/services/api-v1/retention-sweep", () => ({
	startRetentionSweep: step("worker"),
}));
vi.mock("~/server/services/payments/auto-finalize", () => ({
	startAutoFinalizePayments: step("worker"),
}));

const { register } = await import("./instrumentation");

beforeEach(() => {
	vi.stubEnv("NEXT_RUNTIME", "nodejs");
	calls.length = 0;
	gate.error = undefined;
});
afterEach(() => vi.unstubAllEnvs());

describe("register", () => {
	it("checks the master key, then the canary, then field encryption, then starts the workers", async () => {
		await register();
		expect(calls).toEqual([
			"master key config",
			"canary",
			"field encryption",
			...Array(5).fill("worker"),
		]);
	});

	it("starts no worker when the field encryption check refuses", async () => {
		gate.error = new Error("refused");
		await expect(register()).rejects.toThrow("refused");
		expect(calls).toEqual(["master key config", "canary", "field encryption"]);
	});
});
