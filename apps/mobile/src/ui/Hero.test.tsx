import { light } from "@retrospend/tokens/theme";
import { Pressable, StyleSheet, type TextStyle } from "react-native";
import { fontFamilyFor } from "@/theme/fonts";
import { Hero } from "./Hero";

// One hero per screen: the label, value and a text sub line read as one
// element; a sub line with a link stays its own element.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));

interface Node {
	type: unknown;
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

	it("draws a hero label in the figure's tone and a quiet sub line", () => {
		const root = render(
			<Hero
				label="Lucia owes you"
				labelTone="hero"
				sub="3 shared expenses"
				subTone="fg3"
				tone="positive"
				value="$5"
			/>,
		);
		const styleOf = (text: string) =>
			StyleSheet.flatten(
				root.findAll(
					(n) => typeof n.type === "string" && n.props.children === text,
				)[0]?.props.style as TextStyle,
			);
		expect(styleOf("Lucia owes you").color).toBe(light.color.positive);
		expect(styleOf("Lucia owes you").fontSize).toBe(light.type.body.size);
		expect(styleOf("3 shared expenses").color).toBe(light.color.fg3);
		expect(styleOf("3 shared expenses").fontSize).toBe(light.type.meta.size);
	});

	it("sets the value at the phone hero size with token weight and tracking", () => {
		const root = render(
			<Hero label="Owed to you" tone="positive" value="$5" />,
		);
		const value = root.findAll(
			(n) =>
				typeof n.type === "string" &&
				StyleSheet.flatten(n.props.style as TextStyle | undefined)?.fontSize ===
					light.size.hero.phone,
		)[0];
		const style = StyleSheet.flatten(value?.props.style as TextStyle) as Record<
			string,
			unknown
		>;
		expect(style.fontFamily).toBe(fontFamilyFor(light.type.hero.weight));
		expect(style.color).toBe(light.color.positive);
		expect(style.letterSpacing).toBeCloseTo(
			light.size.hero.phone * light.type.hero.tracking,
		);
	});
});
