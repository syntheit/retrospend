import { describe, expect, it, vi } from "vitest";
import { copyRecoveryKey } from "./recovery-key-actions";

describe("copyRecoveryKey", () => {
	it("copies the key and says so", async () => {
		const copy = vi.fn(async () => {});
		expect(await copyRecoveryKey({ copy }, "KEY")).toBe(true);
		expect(copy).toHaveBeenCalledWith("KEY");
	});

	it("says false when the clipboard refuses, asynchronously or at once", async () => {
		expect(
			await copyRecoveryKey(
				{ copy: () => Promise.reject(new Error("denied")) },
				"KEY",
			),
		).toBe(false);
		expect(
			await copyRecoveryKey(
				{
					copy: () => {
						throw new Error("no clipboard");
					},
				},
				"KEY",
			),
		).toBe(false);
	});
});
