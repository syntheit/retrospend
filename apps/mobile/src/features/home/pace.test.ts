import { paceLines, paceShape } from "./pace";

describe("paceLines", () => {
	it("draws both months", () => {
		const input = { current: [100, 300], previous: [50, 150, 400] };
		expect(paceLines(input)).toEqual({
			current: [100, 300],
			previous: [50, 150, 400],
		});
	});

	it("says no data when nothing was spent in either month", () => {
		expect(paceLines({ current: [0, 0], previous: [0, 0, 0] })).toEqual({
			current: [],
			previous: [],
		});
		expect(paceLines({ current: null, previous: null })).toEqual({
			current: [],
			previous: [],
		});
	});

	it("draws last month alone, this month still at zero", () => {
		expect(paceLines({ current: [0, 0], previous: [0, 500, 900] })).toEqual({
			current: [0, 0],
			previous: [0, 500, 900],
		});
	});
});

describe("paceShape", () => {
	it("ends this month in a dot at today, on the scale both months share", () => {
		const shape = paceShape(
			{ current: [0, 100], previous: [0, 50, 200] },
			3,
			100,
			50,
			0,
		);
		// Three days across 100 wide: today (the second day) is at x 50.
		expect(shape.end?.x).toBe(50);
		expect(shape.current.startsWith("M0 ")).toBe(true);
		// 100 sits below last month's 200 on one scale.
		const lastPreviousY = Number(
			shape.previous.split("L").pop()?.split(" ")[1],
		);
		expect(shape.end?.y ?? 0).toBeGreaterThan(lastPreviousY);
	});

	it("has no dot without a current line", () => {
		const shape = paceShape({ current: [], previous: [1, 2] }, 2, 100, 50, 4);
		expect(shape.end).toBeNull();
		expect(shape.current).toBe("");
	});
});
