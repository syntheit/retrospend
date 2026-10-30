import { UnderlineTabs } from "./UnderlineTabs";

// Page tabs: a tab list for a screen reader, the open one selected, and a
// press changes the page.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));

interface Node {
	props: Record<string, unknown>;
	findAll(match: (node: Node) => boolean): Node[];
}

describe("UnderlineTabs", () => {
	it("marks the open tab and reports a press", () => {
		const onChange = jest.fn();
		let tree: { root: Node } | undefined;
		act(() => {
			tree = create(
				<UnderlineTabs
					accessibilityLabel="Pages"
					onChange={onChange}
					tabs={[
						{ value: "people", label: "People" },
						{ value: "projects", label: "Projects" },
					]}
					value="people"
				/>,
			);
		});
		const root = (tree as { root: Node }).root;
		const tabs = root.findAll(
			(n) =>
				n.props.accessibilityRole === "tab" &&
				typeof n.props.onPress === "function",
		);
		expect(tabs).toHaveLength(2);
		expect(tabs.map((t) => t.props.accessibilityState)).toEqual([
			{ selected: true },
			{ selected: false },
		]);
		// A press draws no ripple or box: the sliding line is the answer.
		for (const tab of tabs) {
			expect(tab.props.android_ripple).toBeUndefined();
			expect(typeof tab.props.style).not.toBe("function");
		}
		const second = tabs[1] as Node;
		act(() => (second.props.onPress as () => void)());
		expect(onChange).toHaveBeenCalledWith("projects");
		expect(
			root.findAll((n) => n.props.accessibilityRole === "tablist").length,
		).toBeGreaterThan(0);
	});

	it("stops the labels growing past the chrome cap", () => {
		let tree: { root: Node } | undefined;
		act(() => {
			tree = create(
				<UnderlineTabs
					accessibilityLabel="Pages"
					onChange={() => {}}
					tabs={[
						{ value: "people", label: "People" },
						{ value: "projects", label: "Projects" },
					]}
					value="people"
				/>,
			);
		});
		const labels = (tree as { root: Node }).root.findAll(
			(n) => n.props.maxFontSizeMultiplier !== undefined,
		);
		expect(labels.length).toBeGreaterThan(0);
		for (const node of labels)
			expect(node.props.maxFontSizeMultiplier).toBe(1.3);
	});
});
