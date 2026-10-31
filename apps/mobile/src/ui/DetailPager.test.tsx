import { Text } from "react-native";
import { DetailPager, type PagerTab } from "./DetailPager";

// The pager: tabs in a fixed grid, one panel each, swipe or tab to move.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));

interface TestNode {
	props: Record<string, unknown>;
	type: unknown;
	children: (TestNode | string)[];
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

const tabs: PagerTab[] = [
	{ key: "a", label: "Category", icon: "Tag" },
	{ key: "b", label: "When", icon: "Calendar", dot: true },
	{ key: "c", label: "Who", icon: "Users" },
];

function render(page: number, onPageChange = jest.fn()) {
	let tree!: { root: TestNode };
	act(() => {
		tree = create(
			<DetailPager
				dotLabel="changed"
				label="Details"
				onPageChange={onPageChange}
				page={page}
				tabs={tabs}
			>
				<Text>panel a</Text>
				<Text>panel b</Text>
				<Text>panel c</Text>
			</DetailPager>,
		);
	});
	return { tree, onPageChange };
}

const textOf = (n: TestNode | string): string =>
	typeof n === "string" ? n : n.children.map(textOf).join("");

const tab = (tree: { root: TestNode }, label: string) =>
	tree.root.findAll(
		(n) =>
			n.props.accessibilityRole === "tab" && n.props.accessibilityLabel === label,
	)[0];

describe("DetailPager", () => {
	it("draws a tab for each panel, the open one selected, and says which changed", () => {
		const { tree } = render(1);
		expect(tab(tree, "Category")?.props.accessibilityState).toEqual({
			selected: false,
		});
		expect(tab(tree, "When, changed")?.props.accessibilityState).toEqual({
			selected: true,
		});
		expect(tab(tree, "Who")).toBeDefined();
	});

	it("keeps every panel mounted, with only the open one readable by a screen reader", () => {
		const { tree } = render(0);
		const words = tree.root
			.findAll((n) => n.type === Text)
			.map((n) => textOf(n));
		for (const panel of ["panel a", "panel b", "panel c"]) {
			expect(words).toContain(panel);
		}
		const hidden = tree.root.findAll(
			(n) => n.props.importantForAccessibility === "no-hide-descendants",
		);
		expect(hidden.length).toBeGreaterThanOrEqual(2);
	});

	it("asks for a page by tab, and by swipe once a swipe settles on another", () => {
		const { tree, onPageChange } = render(0);
		act(() => (tab(tree, "Who")?.props.onPress as () => void)());
		expect(onPageChange).toHaveBeenLastCalledWith(2, "tab");
		const scroller = tree.root.findAll(
			(n) => typeof n.props.onMomentumScrollEnd === "function",
		)[0];
		// The window of the test renderer is 750 wide: a settle at one page over.
		act(() =>
			(
				scroller?.props.onMomentumScrollEnd as (e: unknown) => void
			)({ nativeEvent: { contentOffset: { x: 750 } } }),
		);
		expect(onPageChange).toHaveBeenLastCalledWith(1, "swipe");
	});

	it("shows icons only on a narrow window", () => {
		const { Dimensions } = require("react-native");
		const spy = jest
			.spyOn(Dimensions, "get")
			.mockReturnValue({ width: 320, height: 640, scale: 2, fontScale: 1 });
		const { tree } = render(0);
		const words = tree.root
			.findAll((n) => n.type === Text)
			.map((n) => textOf(n));
		expect(words).not.toContain("Category");
		expect(tab(tree, "Category")).toBeDefined();
		spy.mockRestore();
	});
});
