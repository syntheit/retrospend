import { dark, light } from "@retrospend/tokens/theme";
import { BUTTON_STYLE, Button } from "./Button.ios";

// The first TestFlight build showed white text on the pale brand fill of the
// dark theme. The filled button is pinned to a solid SwiftUI style (never the
// glass styles, which belong to chrome) and to the token pair that sits on
// the brand fill, and that pair has to read at 4.5:1 in both themes.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface TestNode {
	type: unknown;
	props: Record<string, unknown>;
	findByType(type: string): TestNode;
}

const mockTheme: { current: typeof light } = { current: light };
jest.mock("@/theme", () => ({ useTheme: () => mockTheme.current }));
jest.mock("./NativeHost", () => ({
	NativeHost: ({ children }: { children: unknown }) => children,
}));
jest.mock("@expo/ui/swift-ui", () => {
	const React = require("react");
	return {
		Button: (props: Record<string, unknown>) =>
			React.createElement("SwiftButton", props),
		Text: (props: Record<string, unknown>) =>
			React.createElement("SwiftText", props),
	};
});

function luminance(hex: string): number {
	const channel = (i: number) => {
		const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type Modifier = { $type: string } & Record<string, unknown>;

function render(theme: typeof light, props: Parameters<typeof Button>[0]) {
	mockTheme.current = theme;
	let tree: { root: TestNode } | undefined;
	act(() => {
		tree = create(<Button {...props} />);
	});
	const root = (tree as NonNullable<typeof tree>).root;
	const button = root.findByType("SwiftButton");
	const text = root.findByType("SwiftText");
	return {
		button: button.props.modifiers as Modifier[],
		label: text.props.modifiers as Modifier[],
	};
}

const find = (modifiers: Modifier[], type: string) =>
	modifiers.find((m) => m.$type === type);

describe.each([
	["light", light],
	["dark", dark],
])("filled Button in the %s theme", (_name, theme) => {
	it("is a solid prominent fill, not glass", () => {
		const { button } = render(theme, { label: "Sign in" });
		expect(BUTTON_STYLE.filled).toBe("borderedProminent");
		expect(find(button, "buttonStyle")?.style).toBe("borderedProminent");
	});

	it("tints with the brand and labels with the brand foreground", () => {
		const { button, label } = render(theme, { label: "Sign in" });
		expect(JSON.stringify(find(button, "tint"))).toContain(theme.color.brand);
		expect(JSON.stringify(find(label, "foregroundStyle"))).toContain(
			theme.color.brandFg,
		);
	});

	it("keeps the brand foreground readable on the brand fill", () => {
		expect(
			contrast(theme.color.brandFg, theme.color.brand),
		).toBeGreaterThanOrEqual(4.5);
	});
});

describe("other variants", () => {
	it("never uses a glass style", () => {
		expect(Object.values(BUTTON_STYLE).join(" ")).not.toMatch(/glass/i);
	});

	it("labels outlined and text buttons in the brand color", () => {
		for (const variant of ["outlined", "text"] as const) {
			const { label } = render(light, { label: "Change", variant });
			expect(JSON.stringify(find(label, "foregroundStyle"))).toContain(
				light.color.brand,
			);
		}
	});

	it("reads the brand color on the page in both themes", () => {
		expect(contrast(light.color.brand, light.color.bg)).toBeGreaterThanOrEqual(
			4.5,
		);
		expect(contrast(dark.color.brand, dark.color.bg)).toBeGreaterThanOrEqual(
			4.5,
		);
	});
});
