import { describe, expect, it } from "vitest";
import { categorizeSchema } from "../input";

describe("categorizeSchema", () => {
	it("keeps what an undo sends: each move's analytics flag and lenient", () => {
		const undo = {
			moves: [
				{ categoryId: "c1", ids: ["a"], excluded: false },
				{ categoryId: null, ids: ["b"], excluded: true },
			],
			lenient: true,
		};
		expect(categorizeSchema.parse(undo)).toEqual(undo);
	});

	it("takes the first move as the person chose it, without a flag", () => {
		const first = { moves: [{ categoryId: "c1", ids: ["a", "b"] }] };
		expect(categorizeSchema.parse(first)).toEqual(first);
	});

	it("refuses an empty list of ids, and more than 500 in a move", () => {
		expect(
			categorizeSchema.safeParse({ moves: [{ categoryId: "c1", ids: [] }] })
				.success,
		).toBe(false);
		expect(
			categorizeSchema.safeParse({
				moves: [
					{
						categoryId: "c1",
						ids: Array.from({ length: 501 }, (_, i) => `e${i}`),
					},
				],
			}).success,
		).toBe(false);
	});
});
