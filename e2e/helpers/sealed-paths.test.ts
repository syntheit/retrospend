import { describe, expect, it } from "vitest";
import { sealedPaths } from "./sealed-paths";

describe("sealedPaths", () => {
	it("names every string that starts with U+0001, never its value", () => {
		const body = {
			result: {
				data: {
					json: [
						{ title: "plain", note: "\u0001k1:AAAA" },
						{ nested: { name: "\u0001k1:BBBB" } },
					],
				},
			},
			count: 2,
		};
		expect(sealedPaths(body)).toEqual([
			"$.result.data.json[0].note",
			"$.result.data.json[1].nested.name",
		]);
	});

	it("ignores U+0001 anywhere but the start, keys, numbers and nulls", () => {
		expect(
			sealedPaths({ "\u0001key": "a", mid: "a\u0001b", n: 1, z: null }),
		).toEqual([]);
	});
});
