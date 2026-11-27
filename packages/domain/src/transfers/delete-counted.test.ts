/** Hand-derived: the order give, take, floor, cap, and each step where it binds. */
import { describe, expect, it } from "vitest";
import { dec } from "../precise-decimal";
import { countedAfterDelete } from "./delete-counted";

const counted = (
	start: string,
	balance: string,
	give: string,
	take: string,
	type = "INVESTMENT",
) =>
	countedAfterDelete(
		{ type, countedUnits: dec(start), balance: dec(balance) },
		{ give: dec(give), take: dec(take) },
	).toString();

describe("counted units after a transfer is deleted", () => {
	it("the source gets its units back: 200 + 100 under a balance of 500 is 300", () => {
		expect(counted("200", "500", "100", "0")).toBe("300");
	});

	it("the destination gives them back: 150 - 100 is 50", () => {
		expect(counted("150", "500", "0", "100")).toBe("50");
	});

	it("the floor binds: 20 - 100 is -80, so 0 (the cap alone would keep -80)", () => {
		expect(counted("20", "970", "0", "100")).toBe("0");
	});

	it("the cap binds after the give: 0 + 100 over a balance of 50 is 50", () => {
		expect(counted("0", "50", "100", "0")).toBe("50");
	});

	it("an account holding nothing keeps none, and a liability has none", () => {
		expect(counted("5", "0", "10", "0")).toBe("0");
		expect(counted("0", "-20", "10", "0")).toBe("0");
		expect(counted("0", "1000", "10", "0", "LIABILITY_LOAN")).toBe("0");
	});
});
