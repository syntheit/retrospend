import { describe, expect, it } from "vitest";
import { shareCounts, UNCOUNTED_SHARE_STATUSES } from "./share-status";

describe("shareCounts", () => {
	it("skips a rejected share and keeps every other status", () => {
		expect(shareCounts("REJECTED")).toBe(false);
		for (const s of ["PENDING", "ACCEPTED", "AUTO_ACCEPTED"])
			expect(shareCounts(s)).toBe(true);
	});

	it("is driven by the one list", () => {
		expect(UNCOUNTED_SHARE_STATUSES).toEqual(["REJECTED"]);
	});
});
