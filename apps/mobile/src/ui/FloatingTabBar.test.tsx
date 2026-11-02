import { FloatingTabBar, type FloatingTabBarProps } from "./FloatingTabBar";
import { scrollFocusedToTop } from "./scrollToTop";
import { floatingBarMetrics, tabBarFootprint } from "./tabBarMetrics";

// The Android floating bar: a tab list for a screen reader with the open tab
// selected, a press on another tab navigates, a press on the open tab emits
// tabPress (the stack pops to its root) and scrolls a root list to the top.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("./scrollToTop", () => ({ scrollFocusedToTop: jest.fn() }));

interface Node {
	props: Record<string, unknown>;
	findAll(match: (node: Node) => boolean): Node[];
}

const TABS = [
	{ name: "home", label: "Home", glyph: "Home" },
	{ name: "activity", label: "Activity", glyph: "ReceiptText" },
	{ name: "budget", label: "Budget", glyph: "ChartPie" },
	{ name: "wealth", label: "Wealth", glyph: "Landmark" },
	{ name: "people", label: "People", glyph: "Users" },
] as const;

function props(
	index: number,
	nestedIndex = 0,
): FloatingTabBarProps & {
	emit: jest.Mock;
	navigateToTab: jest.Mock;
} {
	const emit = jest.fn(() => ({ defaultPrevented: false }));
	const navigateToTab = jest.fn();
	return {
		tabs: TABS,
		state: {
			index,
			routes: [
				...TABS.map((tab, i) => ({
					key: `${tab.name}-key`,
					name: tab.name,
					state: i === index ? { index: nestedIndex } : undefined,
				})),
				{ key: "recurring-key", name: "recurring" },
			],
		},
		emitter: { emit },
		navigateToTab,
		insets: { bottom: 24 },
		emit,
	};
}

function tabsOf(p: FloatingTabBarProps) {
	let tree: { root: Node } | undefined;
	act(() => {
		tree = create(<FloatingTabBar {...p} />);
	});
	return (tree as { root: Node }).root.findAll(
		(n) =>
			n.props.accessibilityRole === "tab" &&
			typeof n.props.onPress === "function",
	);
}

function pressIn(tabs: Node[], index: number) {
	const onPressIn = tabs[index]?.props.onPressIn as (() => void) | undefined;
	act(() => onPressIn?.());
}

function press(tabs: Node[], index: number) {
	const onPress = tabs[index]?.props.onPress as (() => void) | undefined;
	act(() => onPress?.());
}

describe("FloatingTabBar", () => {
	beforeEach(() => jest.mocked(scrollFocusedToTop).mockClear());

	it("lists five tabs and marks the open one selected", () => {
		const tabs = tabsOf(props(1));
		expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(
			TABS.map((t) => t.label),
		);
		expect(
			tabs.map(
				(t) => (t.props.accessibilityState as { selected: boolean }).selected,
			),
		).toEqual([false, true, false, false, false]);
	});

	it("goes to another tab on a press", () => {
		const p = props(0);
		const tabs = tabsOf(p);
		press(tabs, 2);
		expect(p.emit).toHaveBeenCalledWith({
			type: "tabPress",
			target: "budget-key",
			canPreventDefault: true,
		});
		expect(p.navigateToTab).toHaveBeenCalledWith("budget-key");
		expect(scrollFocusedToTop).not.toHaveBeenCalled();
	});

	it("goes to another tab on touch down, and the release does not go twice", () => {
		const p = props(0);
		const tabs = tabsOf(p);
		pressIn(tabs, 3);
		expect(p.emit).toHaveBeenCalledTimes(1);
		expect(p.navigateToTab).toHaveBeenCalledWith("wealth-key");
		press(tabs, 3);
		expect(p.emit).toHaveBeenCalledTimes(1);
		expect(p.navigateToTab).toHaveBeenCalledTimes(1);
	});

	it("shows the pressed tab as open before the navigator has moved", () => {
		const p = props(0);
		let tree: { root: Node } | undefined;
		act(() => {
			tree = create(<FloatingTabBar {...p} />);
		});
		const find = () =>
			(tree as { root: Node }).root.findAll(
				(n) =>
					n.props.accessibilityRole === "tab" &&
					typeof n.props.onPress === "function",
			);
		pressIn(find(), 2);
		expect(
			find().map(
				(t) => (t.props.accessibilityState as { selected: boolean }).selected,
			),
		).toEqual([false, false, true, false, false]);
	});

	it("does not leave on touch down when a listener prevents the press", () => {
		const p = props(0);
		p.emit.mockReturnValue({ defaultPrevented: true });
		const tabs = tabsOf(p);
		pressIn(tabs, 1);
		expect(p.navigateToTab).not.toHaveBeenCalled();
	});

	it("leaves the open tab to its press (pop to the root)", () => {
		const p = props(0, 1);
		const tabs = tabsOf(p);
		pressIn(tabs, 0);
		expect(p.emit).not.toHaveBeenCalled();
		press(tabs, 0);
		expect(p.emit).toHaveBeenCalledTimes(1);
		expect(p.navigateToTab).not.toHaveBeenCalled();
	});

	it("scrolls to the top when the open tab is at its root", () => {
		const p = props(0, 0);
		const tabs = tabsOf(p);
		press(tabs, 0);
		expect(p.emit).toHaveBeenCalledTimes(1);
		expect(p.navigateToTab).not.toHaveBeenCalled();
		expect(scrollFocusedToTop).toHaveBeenCalledTimes(1);
	});

	it("only pops when the open tab has a page pushed", () => {
		const p = props(0, 1);
		const tabs = tabsOf(p);
		press(tabs, 0);
		expect(p.emit).toHaveBeenCalledTimes(1);
		expect(scrollFocusedToTop).not.toHaveBeenCalled();
	});

	it("does nothing more when a listener prevents the press", () => {
		const p = props(0);
		p.emit.mockReturnValue({ defaultPrevented: true });
		const tabs = tabsOf(p);
		press(tabs, 1);
		expect(p.navigateToTab).not.toHaveBeenCalled();
	});

	it("keeps the 48 point touch target and clears the Add button by its footprint", () => {
		const theme = require("@retrospend/tokens/theme").light;
		const bar = floatingBarMetrics(theme);
		expect(bar.tab).toBeGreaterThanOrEqual(48);
		expect(bar.sideGap).toBe(12);
		expect(tabBarFootprint(theme, "android")).toBe(bar.footprint);
		expect(tabBarFootprint(theme, "ios")).toBe(49);
	});
});
