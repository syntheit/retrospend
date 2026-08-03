import { readFileSync } from "node:fs";
import {
	isStructurallySame,
	parse,
	TYPE,
	type MessageFormatElement,
} from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "./locales";

type FlatCatalog = Record<string, string>;

function collectVariableTypes(
	ast: MessageFormatElement[],
	result = new Map<string, TYPE>(),
): Map<string, TYPE> {
	for (const element of ast) {
		switch (element.type) {
			case TYPE.literal:
			case TYPE.pound:
				break;
			case TYPE.tag:
				result.set(element.value, element.type);
				collectVariableTypes(element.children, result);
				break;
			case TYPE.plural:
			case TYPE.select:
				result.set(element.value, element.type);
				for (const option of Object.values(element.options)) {
					collectVariableTypes(option.value, result);
				}
				break;
			default:
				if (!result.has(element.value)) {
					result.set(element.value, element.type);
				}
		}
	}

	return result;
}

function collectSelectOptions(
	ast: MessageFormatElement[],
	result = new Map<string, string[]>(),
): Map<string, string[]> {
	for (const element of ast) {
		if (element.type === TYPE.select) {
			result.set(element.value, Object.keys(element.options).sort());
		}

		if (element.type === TYPE.plural || element.type === TYPE.select) {
			for (const option of Object.values(element.options)) {
				collectSelectOptions(option.value, result);
			}
		} else if (element.type === TYPE.tag) {
			collectSelectOptions(element.children, result);
		}
	}

	return result;
}

function collectExactPluralOptions(
	ast: MessageFormatElement[],
	result = new Map<string, string[]>(),
): Map<string, string[]> {
	for (const element of ast) {
		if (element.type === TYPE.plural) {
			result.set(
				element.value,
				Object.keys(element.options)
					.filter((option) => option.startsWith("="))
					.sort(),
			);
		}

		if (element.type === TYPE.plural || element.type === TYPE.select) {
			for (const option of Object.values(element.options)) {
				collectExactPluralOptions(option.value, result);
			}
		} else if (element.type === TYPE.tag) {
			collectExactPluralOptions(element.children, result);
		}
	}

	return result;
}

function hasCompatibleIcuVariables(
	sourceAst: MessageFormatElement[],
	localizedAst: MessageFormatElement[],
): boolean {
	const structurallySame = isStructurallySame(sourceAst, localizedAst).success;
	const sourceVariables = collectVariableTypes(sourceAst);
	const localizedVariables = collectVariableTypes(localizedAst);
	const countTypes = new Set([TYPE.argument, TYPE.number, TYPE.plural]);

	if (sourceVariables.size !== localizedVariables.size) {
		return false;
	}

	const variablesMatch =
		structurallySame ||
		Array.from(sourceVariables).every(([name, sourceType]) => {
			const localizedType = localizedVariables.get(name);

			return (
				localizedType === sourceType ||
				(localizedType !== undefined &&
					countTypes.has(sourceType) &&
					countTypes.has(localizedType))
			);
		});

	if (!variablesMatch) {
		return false;
	}

	const localizedSelectOptions = collectSelectOptions(localizedAst);
	for (const [name, options] of collectSelectOptions(sourceAst)) {
		if (localizedSelectOptions.get(name)?.join("\0") !== options.join("\0")) {
			return false;
		}
	}

	const localizedExactPlurals = collectExactPluralOptions(localizedAst);
	for (const [name, options] of collectExactPluralOptions(sourceAst)) {
		if (
			options.some(
				(option) => !localizedExactPlurals.get(name)?.includes(option),
			)
		) {
			return false;
		}
	}

	return true;
}

function readCatalog(locale: string): Record<string, unknown> {
	const url = new URL(`../../messages/${locale}.json`, import.meta.url);
	return JSON.parse(readFileSync(url, "utf8")) as Record<string, unknown>;
}

function flattenCatalog(
	value: Record<string, unknown>,
	prefix = "",
	result: FlatCatalog = {},
): FlatCatalog {
	for (const [key, child] of Object.entries(value)) {
		const path = prefix ? `${prefix}.${key}` : key;

		if (typeof child === "string") {
			result[path] = child;
		} else if (child && typeof child === "object" && !Array.isArray(child)) {
			flattenCatalog(child as Record<string, unknown>, path, result);
		} else {
			throw new TypeError(`Message ${path} must be a string or namespace`);
		}
	}

	return result;
}

describe("ICU variable compatibility", () => {
	it("allows locale-specific pluralization of a simple count", () => {
		expect(
			hasCompatibleIcuVariables(
				parse("across {count} projects"),
				parse(
					"{count, plural, one {в # проекте} few {в # проектах} many {в # проектах} other {в # проектах}}",
				),
			),
		).toBe(true);
	});

	it("allows a locale without grammatical plurals to simplify a plural", () => {
		expect(
			hasCompatibleIcuVariables(
				parse("{count, plural, one {# project} other {# projects}}"),
				parse("{count} 个项目"),
			),
		).toBe(true);
	});

	it("rejects missing or renamed variables and tags", () => {
		expect(
			hasCompatibleIcuVariables(
				parse("Hello <strong>{name}</strong>"),
				parse("Здравствуйте, {person}"),
			),
		).toBe(false);
	});

	it("rejects missing select and exact-number plural branches", () => {
		expect(
			hasCompatibleIcuVariables(
				parse(
					"{status, select, open {Open} closed {Closed} other {Unknown}}",
				),
				parse("{status, select, open {Offen} other {Unbekannt}}"),
			),
		).toBe(false);
		expect(
			hasCompatibleIcuVariables(
				parse("{count, plural, =0 {None} one {One} other {Many}}"),
				parse("{count, plural, one {Eins} other {Mehrere}}"),
			),
		).toBe(false);
	});
});

describe("localized message catalogs", () => {
	const english = flattenCatalog(readCatalog("en"));
	const englishKeys = Object.keys(english);

	for (const locale of SUPPORTED_LOCALES.filter((value) => value !== "en")) {
		it(`${locale} matches English keys and ICU variables`, () => {
			const localized = flattenCatalog(readCatalog(locale));
			const localizedKeys = Object.keys(localized);
			const missing = englishKeys.filter((key) => !(key in localized));
			const extra = localizedKeys.filter((key) => !(key in english));
			const empty = localizedKeys.filter((key) => !localized[key]?.trim());
			const orderMatches = englishKeys.every(
				(key, index) => localizedKeys[index] === key,
			);
			const icuErrors: string[] = [];

			for (const key of englishKeys.filter((value) => value in localized)) {
				try {
					const sourceAst = parse(english[key]!);
					const localizedAst = parse(localized[key]!);

					if (!hasCompatibleIcuVariables(sourceAst, localizedAst)) {
						icuErrors.push(`${key}: ICU variables or tags do not match English`);
					}
				} catch (error) {
					icuErrors.push(
						`${key}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}

			expect({ missing, extra, empty, orderMatches, icuErrors }).toEqual({
				missing: [],
				extra: [],
				empty: [],
				orderMatches: true,
				icuErrors: [],
			});
		});
	}
});
