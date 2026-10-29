import { light } from "@retrospend/tokens/theme";
import { Pressable } from "react-native";
import { Hero } from "./Hero";

// One hero per screen: the label, value and a text sub line read as one
// element; a sub line with a link stays its own element.
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

describe("Hero", () => {
	it("reads the label, value and sub line as one element", () => {
		const root = render(
			<Hero label="Net worth" sub="+$120 in 30 days" value="$1,920" />,
		);
		const group = root.findAll((n) => n.props.accessible === true)[0];
		expect(group?.props.accessibilityLabel).toBe(
			"Net worth, $1,920, +$120 in 30 days",
		);
	});

	it("keeps a sub line with a link outside the element", () => {
		const root = render(
			<Hero
				label="Net worth"
				sub={<Pressable accessibilityLabel="Why it changed" />}
				value="$1,920"
			/>,
		);
		const group = root.findAll((n) => n.props.accessible === true)[0];
		expect(group?.props.accessibilityLabel).toBe("Net worth, $1,920");
		expect(
			root.findAll((n) => n.props.accessibilityLabel === "Why it changed")
				.length,
		).toBeGreaterThan(0);
	});

	it("sets the value at the phone hero size with token weight and tracking", () => {
		const root = render(
			<Hero label="Owed to you" tone="positive" value="$5" />,
		);
		const value = root.findAll(
			(n) =>
				(n.props.style as { fontSize?: number } | undefined)?.fontSize ===
				light.size.hero.phone,
		)[0];
		const style = value?.props.style as Record<string, unknown>;
		expect(style.fontWeight).toBe("600");
		expect(style.color).toBe(light.color.positive);
		expect(style.letterSpacing).toBeCloseTo(
			light.size.hero.phone * light.type.hero.tracking,
		);
	});
});
