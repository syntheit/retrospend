import { OperatorKeys } from "./OperatorKeys";

// The four operator keys are chrome: their signs stop growing with the text
// size at the chrome cap, and the key is sized by the touch minimum alone, so
// a larger sign never meets a fixed pill.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

interface Node {
	type: unknown;
	props: Record<string, unknown>;
	findAll(match: (node: Node) => boolean): Node[];
}

const { size } = require("@retrospend/tokens/theme").light;

describe("OperatorKeys", () => {
	it("caps each sign at the chrome scale and sizes the key by the touch minimum", () => {
		const onOperator = jest.fn();
		let tree!: { root: Node };
		act(() => {
			tree = create(<OperatorKeys onOperator={onOperator} />);
		});
		const signs = tree.root.findAll(
			(n) => n.type === "Text" && n.props.maxFontSizeMultiplier !== undefined,
		);
		expect(signs).toHaveLength(4);
		for (const sign of signs)
			expect(sign.props.maxFontSizeMultiplier).toBe(1.3);
		const keys = tree.root.findAll(
			(n) =>
				n.props.accessibilityRole === "button" &&
				typeof n.props.style === "function",
		);
		expect(keys).toHaveLength(4);
		const style = (keys[0] as Node).props.style as (s: {
			pressed: boolean;
		}) => Record<string, unknown>;
		expect(style({ pressed: false }).minHeight).toBe(size.touchMin.phone);
		expect(style({ pressed: false }).height).toBeUndefined();
	});
});
