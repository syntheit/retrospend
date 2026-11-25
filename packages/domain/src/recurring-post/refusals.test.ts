import { describe, expect, it } from "vitest";
import { ITEM_ALREADY_SETTLED, RecurringRefusal } from "./refusals";

describe("RecurringRefusal", () => {
	it("carries its kind and the message the person sees", () => {
		const refusal = new RecurringRefusal("not_due", ITEM_ALREADY_SETTLED);
		expect(refusal).toBeInstanceOf(Error);
		expect(refusal.kind).toBe("not_due");
		expect(refusal.message).toBe("This item was already confirmed or skipped");
		expect(refusal.name).toBe("RecurringRefusal");
	});
});
