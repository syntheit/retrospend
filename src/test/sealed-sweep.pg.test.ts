/**
 * The sealed suite's sweep (sealed-sweep.ts) names plaintext a file left in a
 * mapped column, and nothing an earlier file left or a sealed value.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createTestUser } from "./pg-harness";
import { restoreCells, writeCell } from "./sealed-fixture";
import { startSweep } from "./sealed-sweep";

describe("the sealed sweep", () => {
	// The written cells hold no real ciphertext: put back what was there.
	afterAll(restoreCells);

	it("fails on a new plaintext cell, by table and column, and passes once it is sealed", async () => {
		const { user } = await createTestUser();
		// Empty when the file starts ("" is no plaintext), whatever the mode.
		await writeCell("user", "name", user.id, "");
		const end = await startSweep();
		const id = randomUUID();
		await writeCell("user", "name", user.id, `Plain ${id}`);
		await expect(end()).rejects.toThrow(
			/Plaintext left in mapped columns with sealing on: user\.name: 1$/,
		);
		await writeCell("user", "name", user.id, "\u0001k1:sealed");
		await expect(end()).resolves.toBeUndefined();
	});

	it("ignores plaintext that was there when the file started", async () => {
		const { user } = await createTestUser();
		await writeCell("user", "name", user.id, "Already plaintext");
		const end = await startSweep();
		await expect(end()).resolves.toBeUndefined();
		await writeCell("user", "name", user.id, "\u0001k1:sealed");
	});
});
