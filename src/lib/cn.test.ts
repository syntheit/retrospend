import { readFileSync } from "node:fs";
import { join } from "node:path";
import tokens from "@retrospend/tokens/tokens.json";
import { describe, expect, it } from "vitest";
import { cn, TOKEN_CLASS_NAMES } from "./cn";

const names = (prefix: string) =>
	[
		...new Set(
			Object.keys(tokens.light)
				.filter((k) => k.startsWith(`${prefix}.`))
				.map((k) => k.split(".")[1]),
		),
	].sort();

const sorted = (list: readonly string[]) => [...list].sort();

describe("cn with the design tokens", () => {
	it("keeps a type-scale size next to a token color", () => {
		expect(cn("text-small text-fg-2")).toBe("text-small text-fg-2");
		expect(cn("text-meta text-fg-3 font-medium")).toBe(
			"text-meta text-fg-3 font-medium",
		);
	});

	it("lets a later token class win over the same kind", () => {
		expect(cn("text-body", "text-small")).toBe("text-small");
		expect(cn("rounded-lg", "rounded-ctl")).toBe("rounded-ctl");
		expect(cn("shadow-ctl", "shadow-menu")).toBe("shadow-menu");
		expect(cn("h-8", "h-ctl")).toBe("h-ctl");
		expect(cn("h-ctl", "h-ctl-sm")).toBe("h-ctl-sm");
		expect(cn("ease-land", "ease-leave")).toBe("ease-leave");
	});

	it("lists the same names as @retrospend/tokens", () => {
		expect(sorted(TOKEN_CLASS_NAMES.text)).toEqual(names("type"));
		expect(sorted(TOKEN_CLASS_NAMES.radius)).toEqual(names("radius"));
		expect(sorted(TOKEN_CLASS_NAMES.shadow)).toEqual(names("shadow"));
		expect(sorted(TOKEN_CLASS_NAMES.ease)).toEqual(names("easing"));
	});

	it("lists the same spacing names as the generated theme", () => {
		const css = readFileSync(
			join(import.meta.dirname, "../styles/tokens.css"),
			"utf8",
		);
		const spacing = [...css.matchAll(/--spacing-([\w-]+):/g)].map((m) => m[1]);
		expect(sorted(TOKEN_CLASS_NAMES.spacing)).toEqual(
			sorted(spacing as string[]),
		);
	});
});
