import { Text } from "react-native";
import { MoneyKeypad } from "./MoneyKeypad";

// The pad keeps its height at any text size: every key label stops scaling
// at 1.3, so the 0, decimal and Delete keys of the last row are never pushed
// off a sheet by large text.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

jest.mock("@/theme", () => ({
	useTheme: () => require("@retrospend/tokens/theme").light,
}));
jest.mock("@/lib/money", () => ({
	useMoneyLocale: () => "en-US",
}));
jest.mock("use-intl", () => ({
	useTranslations: () => (key: string) => `word:${key}`,
}));

interface TestNode {
	props: Record<string, unknown>;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

describe("MoneyKeypad", () => {
	it("caps every key label's text scale and keeps all twelve keys", () => {
		let tree: { root: TestNode } | undefined;
		act(() => {
			tree = create(
				<MoneyKeypad currency="USD" draft="" onDraftChange={() => {}} />,
			);
		});
		const texts = tree?.root.findAll(
			(node) => (node as unknown as { type: unknown }).type === Text,
		);
		expect(texts).toHaveLength(12);
		for (const text of texts ?? []) {
			expect(text.props.maxFontSizeMultiplier).toBe(1.3);
		}
	});
});
