import { describe, expect, it } from "vitest";
import { customRateSchema } from "./rate";

const ok = (v: unknown) => customRateSchema.safeParse(v).success;

describe("customRateSchema: a typed rate as a decimal string", () => {
	it("keeps the text exactly as typed", () => {
		expect(customRateSchema.parse("1.083412345678")).toBe("1.083412345678");
		expect(customRateSchema.parse("1234.567890123")).toBe("1234.567890123");
		// 16 digits before the point and 12 after: DECIMAL(28,12), the homeRate column.
		expect(ok("1234567890123456.123456789012")).toBe(true);
		expect(ok("0.000000000001")).toBe(true);
	});

	it("refuses zero and negatives", () => {
		expect(ok("0")).toBe(false);
		expect(ok("0.000")).toBe(false);
		expect(ok("000")).toBe(false);
		expect(ok("-1.08")).toBe(false);
	});

	it("refuses text that is not a plain decimal", () => {
		const texts = ["NaN", "Infinity", "abc", "", " 1.08", "1,08", "1e3", ".5"];
		for (const v of [...texts, "1."]) {
			expect(ok(v), v).toBe(false);
		}
	});

	it("refuses numbers: a float already lost the digits", () => {
		expect(ok(1.0834)).toBe(false);
	});

	it("refuses more digits than the column stores", () => {
		expect(ok("1.0834123456789")).toBe(false);
		expect(ok("12345678901234567")).toBe(false);
	});
});
