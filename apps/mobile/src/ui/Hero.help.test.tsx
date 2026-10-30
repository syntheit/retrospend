import { Hero } from "./Hero";

// The help button beside the label: its own element with a label and a hint,
// outside the element that reads the figure.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));

interface Node {
	props: Record<string, unknown>;
	findAll(match: (node: Node) => boolean): Node[];
}

function render(element: React.ReactElement): Node {
	let tree: { root: Node } | undefined;
	act(() => {
		tree = create(element);
	});
	return (tree as { root: Node }).root;
}

describe("Hero help", () => {
	it("is a labeled button with a hint, apart from the figure's element", () => {
		const onPress = jest.fn();
		const root = render(
			<Hero
				help={{ label: "Help", hint: "Explains the words", onPress }}
				label="Left to spend"
				value="$1,920"
			/>,
		);
		const button = root.findAll(
			(n) => n.props.accessibilityLabel === "Help",
		)[0];
		expect(button?.props.accessibilityRole).toBe("button");
		expect(button?.props.accessibilityHint).toBe("Explains the words");
		act(() => (button?.props.onPress as () => void)());
		expect(onPress).toHaveBeenCalled();
		const group = root.findAll(
			(n) => n.props.accessibilityLiveRegion === "polite",
		)[0];
		expect(group?.props.accessibilityLabel).toBe("Left to spend, $1,920");
	});
});
