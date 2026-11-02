import { backPopsAScreen } from "./predictiveBack";

// A stack at `index`; `inner` is the nested navigator of the focused route.
const stack = (index: number, inner?: object) => ({
	type: "stack",
	index,
	routes: Array.from({ length: index + 1 }, (_, i) => ({
		state: i === index ? (inner as never) : undefined,
	})),
});

// A tab navigator at `index` whose history has `history` entries.
const tabs = (index: number, history: number, inner?: object) => ({
	type: "tab",
	index,
	history: Array.from({ length: history }),
	routes: Array.from({ length: 5 }, (_, i) => ({
		state: i === index ? (inner as never) : undefined,
	})),
});

describe("backPopsAScreen", () => {
	it("is false with no state", () => {
		expect(backPopsAScreen(undefined)).toBe(false);
	});

	it("is false at the root of the app", () => {
		expect(backPopsAScreen(stack(0, tabs(0, 1, stack(0))))).toBe(false);
	});

	it("is true when the root stack has a screen over the tabs", () => {
		expect(backPopsAScreen(stack(1))).toBe(true);
	});

	it("is true for a page pushed inside a tab", () => {
		expect(backPopsAScreen(stack(0, tabs(1, 2, stack(1))))).toBe(true);
	});

	it("is false when back would switch tabs", () => {
		expect(backPopsAScreen(stack(0, tabs(2, 2, stack(0))))).toBe(false);
	});

	it("is true for a page pushed inside the account sheet", () => {
		expect(backPopsAScreen(stack(1, stack(1)))).toBe(true);
	});
});
