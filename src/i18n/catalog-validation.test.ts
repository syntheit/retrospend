import { readFileSync } from "node:fs";
import {
	isStructurallySame,
	parse,
} from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "./locales";

type FlatCatalog = Record<string, string>;

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
					const structure = isStructurallySame(sourceAst, localizedAst);

					if (!structure.success) {
						icuErrors.push(
							`${key}: ${structure.error?.message ?? "ICU structure mismatch"}`,
						);
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
