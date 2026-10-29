import { dark, light } from "@retrospend/tokens/theme";
import type { ReactElement } from "react";
import { StyleSheet, type TextStyle } from "react-native";
import { FONT_FAMILY } from "@/theme";
import { Text, toneColor, typeStyle } from "./Text";

// Every role reads its size, line height, weight and tracking from the type
// tokens, and the weight picks a loaded DM Sans face instead of fontWeight.
const renderer = require("react-test-renderer");
const { act, create } = renderer;

const mockTheme: { current: typeof light } = { current: light };
jest.mock("@/theme", () => ({
	...jest.requireActual("@/theme"),
	useTheme: () => mockTheme.current,
}));

interface TestTree {
	root: { findByType(type: string): { props: { style: unknown } } };
}

function styleOf(element: ReactElement): TextStyle {
	const holder: { tree?: TestTree } = {};
	act(() => {
		holder.tree = create(element);
	});
	const node = holder.tree?.root.findByType("Text");
	return StyleSheet.flatten(node?.props.style as TextStyle) ?? {};
}

const ROLES = ["hero", "title", "section", "body", "small", "meta"] as const;

describe("Text", () => {
	it.each(ROLES)("takes the %s role from the type tokens", (role) => {
		const t = light.type[role];
		const style = typeStyle(light, role);
		expect(style.fontSize).toBe(t.size);
		expect(style.lineHeight).toBe(Math.round(t.size * t.lineHeight));
		expect(style.fontFamily).toBe(FONT_FAMILY[t.weight]);
		expect(style.fontWeight).toBeUndefined();
	});

	it("has a loaded face for each weight token", () => {
		for (const weight of Object.values(light.font.weight))
			expect(FONT_FAMILY[weight]).toMatch(/^DMSans_/);
	});

	it("tracks the hero and title by the token, in points", () => {
		expect(typeStyle(light, "hero").letterSpacing).toBeCloseTo(
			light.type.hero.tracking * light.type.hero.size,
		);
		expect(typeStyle(light, "body").letterSpacing).toBe(0);
	});

	it("gives the hero tabular figures and others on request", () => {
		expect(typeStyle(light, "hero").fontVariant).toEqual(["tabular-nums"]);
		expect(typeStyle(light, "body").fontVariant).toBeUndefined();
		expect(typeStyle(light, "body", { tabular: true }).fontVariant).toEqual([
			"tabular-nums",
		]);
	});

	it("overrides the weight with a weight token", () => {
		expect(typeStyle(light, "body", { weight: "medium" }).fontFamily).toBe(
			FONT_FAMILY[light.font.weight.medium],
		);
	});

	it.each([
		["light", light],
		["dark", dark],
	] as const)("renders body in fg by default (%s)", (_, theme) => {
		mockTheme.current = theme;
		const style = styleOf(<Text>Hi</Text>);
		expect(style.color).toBe(theme.color.fg);
		expect(style.fontSize).toBe(theme.type.body.size);
		mockTheme.current = light;
	});

	it("maps tones to their color jobs", () => {
		expect(toneColor(light, "attention")).toBe(light.color.attentionText);
		expect(toneColor(light, "fg3")).toBe(light.color.fg3);
		const style = styleOf(
			<Text tone="danger" variant="meta">
				Error
			</Text>,
		);
		expect(style.color).toBe(light.color.danger);
		expect(style.fontSize).toBe(light.type.meta.size);
	});

	it("lets a caller style win", () => {
		const style = styleOf(<Text style={{ textAlign: "center" }}>Hi</Text>);
		expect(style.textAlign).toBe("center");
	});
});
