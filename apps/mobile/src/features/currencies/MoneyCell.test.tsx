import { TextInput } from "react-native";
import { cellEdit, cellError, MoneyCell } from "./MoneyCell";

// The inline money field: the amount field's draft rules (grouping, the
// currency's decimals, the shared parser) in a cell with no keypad, and an
// error only once the person has left the field or tried to save.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("@/lib/money", () => ({
	useMoneyLocale: () => "en-US",
	useFormatMoney: () => ({
		format: (m: { minor: number; currency: string }) =>
			`${m.currency} ${m.minor}`,
	}),
}));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => `word:${key}`,
}));

interface TestNode {
	props: Record<string, unknown>;
	findByType(type: unknown): TestNode;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

function render(element: React.ReactElement): TestNode {
	let tree: { root: TestNode } | undefined;
	act(() => {
		tree = create(element);
	});
	if (!tree) throw new Error("did not render");
	return tree.root;
}

describe("cellEdit", () => {
	it("groups thousands while typing and reads the amount", () => {
		const edit = cellEdit("1234.5", "", "en-US", "USD");
		expect(edit.text).toBe("1,234.5");
		expect(edit.result).toEqual({ ok: true, minor: 123450, expression: false });
	});

	it("keeps only the decimals the currency has", () => {
		const edit = cellEdit("12.345", "12.34", "en-US", "USD");
		expect(edit.text).toBe("12.34");
	});
});

describe("cellError", () => {
	const bad = { ok: false, error: "syntax" } as const;
	it("waits for blur or a save attempt", () => {
		expect(cellError(bad, false)).toBeNull();
		expect(cellError(bad, true)).toBe("syntax");
	});
	it("leaves an empty cell and a zero to the row", () => {
		expect(cellError({ ok: false, error: "empty" }, true)).toBeNull();
		expect(cellError({ ok: false, error: "zero" }, true)).toBeNull();
	});
});

describe("MoneyCell", () => {
	it("types on the decimal pad and passes the grouped draft up", () => {
		const onChange = jest.fn();
		const root = render(
			<MoneyCell currency="USD" label="Ana" onChange={onChange} value="" />,
		);
		const input = root.findByType(TextInput);
		expect(input.props.keyboardType).toBe("decimal-pad");
		expect(input.props.accessibilityLabel).toBe("Ana");
		act(() => {
			(input.props.onChangeText as (t: string) => void)("1234");
		});
		expect(onChange).toHaveBeenCalledWith("1,234", expect.anything());
	});

	it("says what is wrong only after the field is left", () => {
		const root = render(
			<MoneyCell currency="USD" label="Ana" onChange={jest.fn()} value="12+" />,
		);
		const words = () =>
			root.findAll((n) => n.props.children === "word:invalid");
		expect(words()).toHaveLength(0);
		act(() => {
			(root.findByType(TextInput).props.onBlur as () => void)();
		});
		expect(words().length).toBeGreaterThan(0);
	});

	it("shows the home amount the server converted, under the cell", () => {
		const root = render(
			<MoneyCell
				currency="ARS"
				home={{ minor: 1000, currency: "USD" }}
				label="Ana"
				onChange={jest.fn()}
				showCurrency
				value="1,000"
			/>,
		);
		expect(
			root.findAll((n) => n.props.children === "USD 1000").length,
		).toBeGreaterThan(0);
		expect(
			root.findAll((n) => n.props.children === "ARS").length,
		).toBeGreaterThan(0);
	});
});
