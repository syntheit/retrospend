/**
 * DATA_KEYS_WRITE=true wires sealing on with no test override (E2EE D11 PR
 * 4.3): the setting is read by `~/env` and handed to sealing() by db.ts. A
 * write through a scoped client stores `\u0001k1:` and reads back plaintext.
 * The flag is set before any module reads the environment.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Keyring } from "~/server/crypto/field-crypto";
import { sealing } from "~/server/crypto/sealing";
import { createTestUser } from "~/test/pg-harness";
import { sealedFile, storedValue, unsealAll } from "~/test/sealed-fixture";

vi.hoisted(() => {
	process.env.DATA_KEYS_WRITE = "true";
});
const master = vi.hoisted(() => ({ ring: undefined as Keyring | undefined }));
vi.mock("~/server/crypto/master-key", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/crypto/master-key")>()),
	getMasterKeyring: () => master.ring,
}));

sealedFile(master);
afterAll(async () => {
	await unsealAll();
	delete process.env.DATA_KEYS_WRITE;
});

describe("DATA_KEYS_WRITE=true", () => {
	it("seals a write and reads it back as plaintext", async () => {
		expect(sealing()).toBe(true);
		const u = await createTestUser();
		const id = randomUUID();
		const created = await u.db.expense.create({
			data: {
				id,
				userId: u.user.id,
				title: "Alquiler",
				amount: "150000",
				currency: "ARS",
				date: new Date("2026-11-02T12:00:00Z"),
				amountInUSD: "100",
				exchangeRate: "1500",
				pricingSource: "MANUAL",
			},
			select: { title: true },
		});
		expect(created.title).toBe("Alquiler");
		for (const stored of [
			await storedValue("expense", "title", id),
			await storedValue("user", "name", u.user.id),
		])
			expect(String(stored).startsWith("\u0001k1:")).toBe(true);
		const read = await u.db.expense.findUnique({
			where: { id },
			select: { title: true },
		});
		expect(read?.title).toBe("Alquiler");
	});
});
