import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const gate = vi.hoisted(() => ({
	canaryError: undefined as Error | undefined,
	error: undefined as Error | undefined,
	gateError: undefined as Error | undefined,
}));
const step = (name: string) => () => {
	calls.push(name);
};

vi.mock("~/server/crypto/master-key", () => ({
	assertMasterKeyConfig: step("master key config"),
}));
vi.mock("~/server/services/keys/floor", () => ({
	assertStartGates: async () => {
		calls.push("start gates");
		if (gate.gateError) throw gate.gateError;
	},
}));
vi.mock("~/server/services/keys/master-canary.service", () => ({
	assertMasterKeyCanary: async () => {
		step("canary")();
		if (gate.canaryError) throw gate.canaryError;
	},
}));
vi.mock("~/server/services/keys/field-encryption-start", () => ({
	assertFieldEncryptionStart: async () => {
		calls.push("field encryption");
		if (gate.error) throw gate.error;
	},
}));
vi.mock("~/server/services/sync/restore", () => ({
	checkSyncRestore: async () => {
		calls.push("sync restore");
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
vi.mock("~/server/services/recurring-auto-post", () => ({
	startRecurringAutoPost: step("worker"),
}));

const { register } = await import("./instrumentation");

beforeEach(() => {
	vi.stubEnv("NEXT_RUNTIME", "nodejs");
	calls.length = 0;
	gate.error = undefined;
	gate.gateError = undefined;
	gate.canaryError = undefined;
});
afterEach(() => vi.unstubAllEnvs());

describe("register", () => {
	it("checks the master key, then the canary, then the start gates, then field encryption, then the sync log, then starts the workers", async () => {
		await register();
		expect(calls).toEqual([
			"master key config",
			"canary",
			"start gates",
			"field encryption",
			"sync restore",
			...Array(6).fill("worker"),
		]);
	});

	it("starts no worker when the field encryption check refuses", async () => {
		gate.error = new Error("refused");
		await expect(register()).rejects.toThrow("refused");
		expect(calls).toEqual([
			"master key config",
			"canary",
			"start gates",
			"field encryption",
		]);
	});

	it("stops at a wrong master key before the start gates run", async () => {
		gate.canaryError = new Error("master_key_mismatch");
		await expect(register()).rejects.toThrow("master_key_mismatch");
		expect(calls).toEqual(["master key config", "canary"]);
	});

	it("starts no worker when a start gate refuses", async () => {
		gate.gateError = new Error("below the floor");
		await expect(register()).rejects.toThrow("below the floor");
		expect(calls).toEqual(["master key config", "canary", "start gates"]);
	});
});
