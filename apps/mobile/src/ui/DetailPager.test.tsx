import { Text } from "react-native";
import {
	DetailPager,
	followOffset,
	PAGER_FAIL_Y,
	PAGER_START,
	type PagerTab,
	settlePage,
} from "./DetailPager";

// The pager: tabs in a fixed grid, one panel each, swipe or tab to move.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface PanConfig {
	enabled: boolean;
	activeOffsetX: [number, number];
	failOffsetY: [number, number];
	onActivate: () => void;
	onUpdate: (event: { translationX: number }) => void;
	onDeactivate: (event: { velocityX: number }) => void;
}
let pan: PanConfig | null = null;

jest.mock("react-native-gesture-handler", () => ({
	GestureDetector: ({ children }: { children: unknown }) => children,
	GestureHandlerRootView: ({ children }: { children: unknown }) => children,
	usePanGesture: (config: PanConfig) => {
		pan = config;
		return {};
	},
}));
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
			n.props.accessibilityRole === "tab" &&
			n.props.accessibilityLabel === label,
	)[0];

function fire(node: TestNode | undefined, prop: string, ...args: unknown[]) {
	const fn = node?.props[prop];
	if (typeof fn !== "function") throw new Error(`nothing to call: ${prop}`);
	act(() => {
		fn(...args);
	});
}

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

	it("asks for a page by tab", () => {
		const { tree, onPageChange } = render(0);
		fire(tab(tree, "Who"), "onPress");
		expect(onPageChange).toHaveBeenLastCalledWith(2, "tab");
	});

	it("starts only on a sideways drag, and yields to the panel's vertical scroll", () => {
		render(0);
		const config = pan as PanConfig;
		expect(config.enabled).toBe(true);
		expect(config.activeOffsetX).toEqual([-PAGER_START, PAGER_START]);
		expect(config.failOffsetY).toEqual([-PAGER_FAIL_Y, PAGER_FAIL_Y]);
	});

	it("asks for the page a released swipe settles on", () => {
		const { onPageChange } = render(0);
		const config = pan as PanConfig;
		// The test window is 750 wide: past half a page, on release, turns it.
		act(() => {
			config.onActivate();
			config.onUpdate({ translationX: -(PAGER_START + 500) });
			config.onDeactivate({ velocityX: 0 });
		});
		expect(onPageChange).toHaveBeenLastCalledWith(1, "swipe");
	});

	it("settles back on a short, slow drag without asking for anything", () => {
		const { onPageChange } = render(0);
		const config = pan as PanConfig;
		act(() => {
			config.onActivate();
			config.onUpdate({ translationX: -(PAGER_START + 100) });
			config.onDeactivate({ velocityX: 0 });
		});
		expect(onPageChange).not.toHaveBeenCalled();
	});

	it("follows the finger one to one past the start distance, held between the ends", () => {
		// No jump when the drag takes hold: the first points are the start distance.
		expect(followOffset(0, -PAGER_START, 400, 3)).toBe(0);
		expect(followOffset(0, -(PAGER_START + 150), 400, 3)).toBe(-150);
		// From page 1, dragging right pulls page 0 in.
		expect(followOffset(-400, PAGER_START + 100, 400, 3)).toBe(-300);
		// Never past the first page or the last: no rubber band.
		expect(followOffset(0, 500, 400, 3)).toBe(0);
		expect(followOffset(-800, -500, 400, 3)).toBe(-800);
	});

	it("lets a fast flick turn the page, one page at a time", () => {
		// 60 points in, flicked left at 1,500 points per second: the next page.
		expect(settlePage(-60, -1500, 400, 3, 0)).toBe(1);
		// The same distance slowly stays.
		expect(settlePage(-60, 0, 400, 3, 0)).toBe(0);
		// Never two pages at once, never off the ends.
		expect(settlePage(-700, -5000, 400, 5, 0)).toBe(1);
		expect(settlePage(0, 5000, 400, 3, 0)).toBe(0);
		expect(settlePage(-800, -5000, 400, 3, 2)).toBe(2);
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
