/**
 * Pins the exact output of the HMAC derivations that predate keyed-hash.ts:
 * the idempotency fingerprint, the export download link and the restore token.
 * Tokens and fingerprints already issued must keep verifying, so the labels and
 * the hex encoding never change. The expected values are literals, computed
 * outside this code with node's crypto: HMAC-SHA256 under
 * HMAC-SHA256(secret, label), over the message, as hex.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({
	env: { BETTER_AUTH_SECRET: "pin-secret-0123456789abcdef" },
}));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/services/entry/undo-stash", () => ({
	keptUndoFiles: () => [],
}));
vi.mock("~/server/storage", () => ({ deleteFile: async () => undefined }));

const NOW = 1_800_000_000_000;

describe("idempotency fingerprint", () => {
	it("is the keyed hash of 'METHOD path', a newline and the key-sorted body", async () => {
		const { hashRequest } = await import(
			"~/server/services/api-v1/idempotency.service"
		);
		const want =
			"b0aeef86fae9d94132a53eefc195caf512e0d5e6c8e3bc9ff343ff2fbf309c33";
		expect(
			await hashRequest("post", "/expenses", {
				title: "Lunch",
				note: "x",
				amount: "10.50",
			}),
		).toBe(want);
	});
});

describe("export download link", () => {
	it("signs job, owner and expiry under the api-v1-export-download label", async () => {
		const { signExportLink, checkExportLink } = await import(
			"~/server/services/api-v1/export-link"
		);
		const { token } = signExportLink("job1", "user1", NOW);
		expect(token).toBe(
			"1800000600000.07abf36fc858b43c23dfaf82ac684f3ed97ae703a937b38c35ba397ee819a075",
		);
		expect(checkExportLink("job1", "user1", token, NOW)).toBe("ok");
	});
});

describe("restore token", () => {
	it("signs the payload text under the entry-restore-token label", async () => {
		const { signPayload, signRestore, readPayload } = await import(
			"~/server/services/entry/restore-token"
		);
		expect(signPayload({ a: 1 })).toEqual({
			data: '{"a":1}',
			sig: "08e1c9b355ec17cd0a2d8adfafc3fce8d625e5c6de02507af36e775e7eee917e",
		});
		const token = signRestore("k", "u1", { id: "e1" }, NOW);
		expect(token).toEqual({
			data: '{"kind":"k","userId":"u1","exp":1800086400000,"payload":{"id":"e1"}}',
			sig: "1f8eef04874c9a74198cf03462e568f3fded04217afec5ec1c31dfa2a3a95316",
		});
		expect(readPayload(token)).toMatchObject({ kind: "k" });
	});
});
