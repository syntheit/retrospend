import { describe, expect, it } from "vitest";
import {
	bookedInOtherHome,
	otherHomeMessage,
	UNDO_NOT_VALID,
	undoAfterHomeChange,
} from "./refusals";

describe("bookedInOtherHome", () => {
	it("is true only for a named home that is not the current one", () => {
		expect(bookedInOtherHome("ARS", "EUR")).toBe(true);
		expect(bookedInOtherHome("ARS", "ARS")).toBe(false);
		expect(bookedInOtherHome(undefined, "EUR")).toBe(false);
		expect(bookedInOtherHome(null, "EUR")).toBe(false);
		expect(bookedInOtherHome("", "EUR")).toBe(false);
	});
});

describe("undoAfterHomeChange", () => {
	it("a typed rate names its home, a table rate says the undo is not valid", () => {
		expect(undoAfterHomeChange("custom", "ARS")).toBe(otherHomeMessage("ARS"));
		expect(undoAfterHomeChange("blue", "ARS")).toBe(UNDO_NOT_VALID);
		expect(undoAfterHomeChange(null, "ARS")).toBe(UNDO_NOT_VALID);
	});
});
