/**
 * The sealed suite's sweep (sealed-sweep.ts) names plaintext a file left in a
 * mapped column, a new row or a new value, "" included, and nothing an
 * earlier file left or a sealed value; an allowed file only in its column.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createTestUser } from "./pg-harness";
import { restoreCells, writeCell } from "./sealed-fixture";
import { startSweep, SWEEP_ALLOWED } from "./sealed-sweep";

const SEALED = "\u0001k1:sealed";
const LEFT = /^Plaintext left in mapped columns with sealing on: user\.name: 1$/;

async function userName(value: string) {
	const { user } = await createTestUser();
	await writeCell("user", "name", user.id, value);
	return (next: string) => writeCell("user", "name", user.id, next);
}

describe("the sealed sweep", () => {
	// The written cells hold no real ciphertext: put back what was there.
	afterAll(restoreCells);

	it("fails on plaintext a file wrote, by table and column, and passes once it is sealed", async () => {
		const set = await userName(SEALED);
		const end = await startSweep();
		await set("Plain");
		await expect(end()).rejects.toThrow(LEFT);
		await set(SEALED);
		await expect(end()).resolves.toBeUndefined();
	});

	it("counts an empty cell as plaintext", async () => {
		const set = await userName(SEALED);
		const end = await startSweep();
		await set("");
		await expect(end()).rejects.toThrow(LEFT);
		await set(SEALED);
	});

	it("ignores plaintext an earlier file left, and catches a new value in it", async () => {
		const set = await userName("Already plaintext");
		const end = await startSweep();
		await expect(end()).resolves.toBeUndefined();
		await set("Changed");
		await expect(end()).rejects.toThrow(LEFT);
		await set(SEALED);
	});

	it("allows a listed file only the column its entry names, and only while it leaves plaintext there", async () => {
		const file = "src/test/sealed-sweep.pg.test.ts";
		SWEEP_ALLOWED[file] = { column: "expense.title", reason: "test" };
		try {
			const set = await userName(SEALED);
			const end = await startSweep();
			await set("Plain");
			await expect(end()).rejects.toThrow(LEFT);
			await set(SEALED);
			await expect(end()).rejects.toThrow(
				/leaves no plaintext in expense\.title now/,
			);
		} finally {
			delete SWEEP_ALLOWED[file];
		}
	});
});
