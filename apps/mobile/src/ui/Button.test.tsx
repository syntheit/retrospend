import { dark, light } from "@retrospend/tokens/theme";
import { BUTTON_STYLE, Button } from "./Button.ios";
import { TEXT_SCALE_CAP } from "./Text";

// The first TestFlight build showed white text on the pale brand fill of the
// dark theme, and build 15 showed the system capsule taller than the kit
// buttons beside it. The filled button is the kit primary drawn by hand at
// the control height (never the glass styles, which belong to chrome), on
// the token pair that sits on the brand fill, and that pair has to read at
// 4.5:1 in both themes.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

interface TestNode {
	type: unknown;
	props: Record<string, unknown>;
	findByType(type: string): TestNode;
	findAll(match: (node: TestNode) => boolean): TestNode[];
}

const mockTheme: { current: typeof light } = { current: light };
jest.mock("@/theme", () => ({ useTheme: () => mockTheme.current }));
jest.mock("./NativeHost", () => ({
	NativeHost: ({ children }: { children: unknown }) => children,
}));
jest.mock("@expo/ui", () => ({
	Host: (props: Record<string, unknown>) =>
		require("react").createElement("ExpoHost", props),
}));
const fontScale = { current: 1 };
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
	__esModule: true,
	default: () => ({
		width: 390,
		height: 844,
		scale: 3,
		fontScale: fontScale.current,
	}),
}));
jest.mock("./fontScale", () => ({ useFontScale: () => fontScale.current }));
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
	__esModule: true,
	default: () => "light",
}));
jest.mock("@expo/ui/swift-ui", () => {
	const React = require("react");
	return {
		Button: (props: Record<string, unknown>) =>
			React.createElement("SwiftButton", props),
		Text: (props: Record<string, unknown>) =>
			React.createElement("SwiftText", props),
		HStack: (props: Record<string, unknown>) =>
			React.createElement("SwiftHStack", props),
		Image: (props: Record<string, unknown>) =>
			React.createElement("SwiftImage", props),
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
	const stacks = root.findAll((n) => n.type === "SwiftHStack");
	return {
		button: button.props.modifiers as Modifier[],
		label: text.props.modifiers as Modifier[],
		shape: (stacks[0]?.props.modifiers ?? []) as Modifier[],
	};
}

const find = (modifiers: Modifier[], type: string) =>
	modifiers.find((m) => m.$type === type);

describe.each([
	["light", light],
	["dark", dark],
])("filled Button in the %s theme", (_name, theme) => {
	it("is the kit primary at the control height, not a system capsule", () => {
		const { button, shape } = render(theme, { label: "Sign in" });
		expect(BUTTON_STYLE.filled).toBe("plain");
		expect(find(button, "buttonStyle")?.style).toBe("plain");
		expect(JSON.stringify(find(shape, "frame"))).toContain(
			`"minHeight":${theme.size.ctl.phone}`,
		);
		const small = render(theme, { label: "Settle up", size: "small" });
		expect(JSON.stringify(find(small.shape, "frame"))).toContain(
			`"minHeight":${theme.size.ctlSm.phone}`,
		);
	});

	it("fills with the brand and labels with the brand foreground", () => {
		const { shape, label } = render(theme, { label: "Sign in" });
		expect(JSON.stringify(find(shape, "background"))).toContain(
			theme.color.brand,
		);
		expect(JSON.stringify(find(label, "foregroundStyle"))).toContain(
			theme.color.brandFg,
		);
	});

	it("fades when disabled", () => {
		const { shape } = render(theme, { label: "Save", disabled: true });
		expect(find(shape, "opacity")).toBeDefined();
		expect(find(render(theme, { label: "Save" }).shape, "opacity")).toBe(
			undefined,
		);
	});

	it("keeps the brand foreground readable on the brand fill", () => {
		expect(
			contrast(theme.color.brandFg, theme.color.brand),
		).toBeGreaterThanOrEqual(4.5);
	});
});

describe("other variants", () => {
	it("fills the width its row gives it, at the same control height", () => {
		mockTheme.current = light;
		let tree: { root: TestNode } | undefined;
		act(() => {
			tree = create(<Button fill label="Open project" variant="outlined" />);
		});
		const root = (tree as NonNullable<typeof tree>).root;
		// The host keeps only the height, so the row decides the width.
		expect(root.findByType("ExpoHost").props.matchContents).toEqual({
			vertical: true,
		});
		const stack = root.findAll((n) => n.type === "SwiftHStack")[0];
		const frames = ((stack?.props.modifiers ?? []) as Modifier[]).filter(
			(m) => m.$type === "frame",
		);
		// expo-ui ignores maxWidth when a height is in the same frame(): two calls.
		expect(frames).toHaveLength(2);
		expect(JSON.stringify(frames[0])).toContain(
			`"minHeight":${light.size.ctl.phone}`,
		);
		expect(JSON.stringify(frames[0])).not.toContain("maxWidth");
		expect(JSON.stringify(frames[1])).toContain("maxWidth");
	});

	it("grows the label with the text size to the chrome cap, never past it", () => {
		const size = (scale: number, small = false) => {
			fontScale.current = scale;
			const { label } = render(light, {
				label: "Record",
				size: small ? "small" : "regular",
			});
			return (find(label, "font") as unknown as { size: number }).size;
		};
		expect(size(1)).toBe(light.type.body.size);
		expect(size(1.15)).toBeCloseTo(light.type.body.size * 1.15);
		expect(size(3.1)).toBeCloseTo(light.type.body.size * TEXT_SCALE_CAP.chrome);
		expect(size(3.1, true)).toBeCloseTo(
			light.type.small.size * TEXT_SCALE_CAP.chrome,
		);
		fontScale.current = 1;
	});

	it("caps the text button's own label at the chrome Dynamic Type step", () => {
		const { button } = render(light, { label: "Change", variant: "text" });
		expect(JSON.stringify(find(button, "dynamicTypeSize"))).toContain(
			"xxLarge",
		);
	});

	it("never uses a glass style", () => {
		expect(Object.values(BUTTON_STYLE).join(" ")).not.toMatch(/glass/i);
	});

	it("labels the text button in the brand color", () => {
		const { label } = render(light, { label: "Change", variant: "text" });
		expect(JSON.stringify(find(label, "foregroundStyle"))).toContain(
			light.color.brand,
		);
	});

	it.each([
		["light", light],
		["dark", dark],
	])(
		"draws outlined as the kit secondary, not a system capsule (%s)",
		(_name, theme) => {
			const { button, label } = render(theme, {
				label: "Cancel",
				variant: "outlined",
			});
			expect(BUTTON_STYLE.outlined).toBe("plain");
			expect(find(button, "buttonStyle")?.style).toBe("plain");
			expect(JSON.stringify(find(label, "foregroundStyle"))).toContain(
				theme.color.fg,
			);
			expect(
				contrast(theme.color.fg, theme.color.surface),
			).toBeGreaterThanOrEqual(4.5);
		},
	);

	it.each([
		["light", light],
		["dark", dark],
	])("draws dangerText as bare danger text (%s)", (_name, theme) => {
		const { button, label } = render(theme, {
			label: "Delete",
			variant: "dangerText",
		});
		expect(find(button, "buttonStyle")?.style).toBe("plain");
		expect(JSON.stringify(find(label, "foregroundStyle"))).toContain(
			theme.color.danger,
		);
		expect(contrast(theme.color.danger, theme.color.bg)).toBeGreaterThanOrEqual(
			4.5,
		);
	});

	it.each([
		["light", light],
		["dark", dark],
	])("fills danger with its own readable foreground (%s)", (_name, theme) => {
		const { button, label, shape } = render(theme, {
			label: "Delete",
			variant: "danger",
		});
		expect(find(button, "buttonStyle")?.style).toBe("plain");
		expect(JSON.stringify(find(shape, "background"))).toContain(
			theme.color.danger,
		);
		expect(JSON.stringify(find(label, "foregroundStyle"))).toContain(
			theme.color.dangerFg,
		);
		expect(
			contrast(theme.color.dangerFg, theme.color.danger),
		).toBeGreaterThanOrEqual(4.5);
	});

	it("draws a small text button like the small dangerText beside it", () => {
		const small = render(light, {
			label: "Resume",
			variant: "text",
			size: "small",
		});
		expect(JSON.stringify(find(small.shape, "frame"))).toContain(
			`"minHeight":${light.size.ctlSm.phone}`,
		);
		expect(JSON.stringify(find(small.label, "foregroundStyle"))).toContain(
			light.color.brand,
		);
		expect(find(small.button, "controlSize")).toBeUndefined();
	});

	it("leaves the regular text button to the system", () => {
		const regular = render(light, { label: "Resume", variant: "text" });
		expect(find(regular.button, "tint")).toBeDefined();
		expect(find(regular.button, "dynamicTypeSize")).toBeDefined();
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
