import { describe, expect, it } from "vitest";
import { createLimiter } from "../limiter";

describe("createLimiter", () => {
	it("never runs more than max at once and runs every call", async () => {
		const run = createLimiter(2);
		let active = 0;
		let peak = 0;
		const work = async () => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((r) => setTimeout(r, 5));
			active--;
			return 1;
		};
		const results = await Promise.all(
			Array.from({ length: 9 }, () => run(work)),
		);
		expect(results).toHaveLength(9);
		expect(peak).toBe(2);
		expect(active).toBe(0);
	});

	it("frees the slot when work throws", async () => {
		const run = createLimiter(1);
		await expect(
			run(async () => Promise.reject(new Error("no"))),
		).rejects.toThrow("no");
		await expect(run(async () => "ok")).resolves.toBe("ok");
	});
});
