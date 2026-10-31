import { Text } from "react-native";
import { SummaryLine, type SummaryPart } from "./SummaryLine";

// The summary: the answers as one wrapping sentence, each part a button.
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

const textOf = (n: TestNode | string): string =>
	typeof n === "string" ? n : n.children.map(textOf).join("");

function fire(node: TestNode | undefined, prop: string, ...args: unknown[]) {
	const fn = node?.props[prop];
	if (typeof fn !== "function") throw new Error(`nothing to call: ${prop}`);
	act(() => {
		fn(...args);
	});
}

describe("SummaryLine", () => {
	it("joins the parts with a middle dot, clamps to two lines, and opens each part's panel", () => {
		const open = jest.fn();
		const parts: SummaryPart[] = [
			{
				key: "c",
				text: "Pick a category",
				tone: "attention",
				onPress: () => open("c"),
			},
			{ key: "w", text: "Today", onPress: () => open("w"), active: true },
			{ key: "p", text: "Personal", onPress: () => open("p") },
		];
		let tree!: { root: TestNode };
		act(() => {
			tree = create(<SummaryLine parts={parts} />);
		});
		const outer = tree.root.findAll((n) => n.type === Text)[0] as TestNode;
		expect(outer.props.numberOfLines).toBe(2);
		expect(textOf(outer)).toBe("Pick a category · Today · Personal");
		const buttons = tree.root.findAll(
			(n) => n.props.accessibilityRole === "button" && n.type === Text,
		);
		expect(buttons).toHaveLength(3);
		expect(buttons[1]?.props.accessibilityState).toEqual({ selected: true });
		fire(buttons[2], "onPress");
		expect(open).toHaveBeenCalledWith("p");
	});
});
