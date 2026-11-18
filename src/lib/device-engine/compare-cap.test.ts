import { MAX_FIGURE_IDS } from "@retrospend/api-contract";
import { MAX_IDS_PER_CALL } from "@retrospend/engine/device";
import { describe, expect, it } from "vitest";

// The engine cannot import the contract (its route builder would ride into the
// phone bundle), so the compare's call size is held to the route's cap here.
describe("the compare's call size", () => {
	it("is the figures route's cap", () => {
		expect(MAX_IDS_PER_CALL).toBe(MAX_FIGURE_IDS);
	});
});
