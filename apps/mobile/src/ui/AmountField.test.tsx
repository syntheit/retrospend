import { Text } from "react-native";
import { AmountField } from "./AmountField";

// The one money input: a visible label, the currency as the picker when it
// can change and as plain flag-and-code text when it cannot (never an inert
// chip), the operator keys over the keypad, and the keypad away on request.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("@/lib/money", () => ({
	useMoneyLocale: () => "en-US",
	useFormatMoney: () => ({ format: () => "$1" }),
}));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => key,
}));
jest.mock("./CurrencyPicker", () => ({
	CurrencyPicker: () => null,
}));
jest.mock("./CurrencyFlag", () => ({ CurrencyFlag: () => null }));
jest.mock("./MoneyKeypad", () => ({ MoneyKeypad: () => null }));
jest.mock("./OperatorKeys", () => ({ OperatorKeys: () => null }));

interface TestNode {
	type: unknown;
	props: Record<string, unknown>;
	findAllByType(type: unknown): TestNode[];
}

function render(props: Partial<Parameters<typeof AmountField>[0]> = {}) {
	let tree: { root: TestNode } | undefined;
	act(() => {
		tree = create(
			<AmountField
				currency="ARS"
				draft=""
				entered={{ state: "empty" }}
				label="Amount"
				onDraftChange={() => undefined}
				{...props}
			/>,
		);
	});
	if (!tree) throw new Error("did not render");
	return tree.root;
}

const has = (root: TestNode, name: string) =>
	root.findAllByType(require(`./${name}`)[name]).length > 0;

describe("AmountField", () => {
	it("shows its label over the field", () => {
		const root = render();
		expect(
			root.findAllByType(Text).some((n) => n.props.children === "Amount"),
		).toBe(true);
	});

	it("hides the label when the sheet already says it, and still speaks it", () => {
		const root = render({ hideLabel: true });
		const texts = root.findAllByType(Text);
		expect(texts.some((n) => n.props.children === "Amount")).toBe(false);
		expect(
			texts.some((n) =>
				String(n.props.accessibilityLabel ?? "").startsWith("Amount,"),
			),
		).toBe(true);
	});

	it("is the currency picker when the form lets the currency change", () => {
		const root = render({
			choose: { currencies: ["ARS", "USD"], onChange: () => undefined },
		});
		expect(has(root, "CurrencyPicker")).toBe(true);
	});

	it("shows a fixed currency as plain text, not a picker", () => {
		const root = render();
		expect(has(root, "CurrencyPicker")).toBe(false);
		expect(
			root.findAllByType(Text).some((n) => n.props.children === "ARS"),
		).toBe(true);
	});

	it("has operator keys by default and the keypad can be put away", () => {
		expect(has(render(), "OperatorKeys")).toBe(true);
		expect(has(render({ operators: false }), "OperatorKeys")).toBe(false);
		const away = render({ keypad: false });
		expect(has(away, "MoneyKeypad")).toBe(false);
		expect(has(away, "OperatorKeys")).toBe(false);
	});
});
