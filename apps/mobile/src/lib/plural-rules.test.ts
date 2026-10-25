import { installPluralRules, pluralCategory } from "./plural-rules";

describe("pluralCategory", () => {
	it("English, German and Spanish: one for exactly 1", () => {
		for (const locale of ["en", "de", "es", "es-AR"]) {
			expect(pluralCategory(locale, 1)).toBe("one");
			expect(pluralCategory(locale, 0)).toBe("other");
			expect(pluralCategory(locale, 2)).toBe("other");
		}
	});

	it("counts the size of a number, not its sign, and has many for round millions", () => {
		expect(pluralCategory("en", -1)).toBe("one");
		expect(pluralCategory("es", 1_000_000)).toBe("many");
		expect(pluralCategory("fr", 2_000_000)).toBe("many");
		expect(pluralCategory("es", 0)).toBe("other");
		expect(pluralCategory("en", 1_000_000)).toBe("other");
	});

	it("French and Portuguese count 0 and 1 as one", () => {
		expect(pluralCategory("fr", 0)).toBe("one");
		expect(pluralCategory("pt-BR", 1)).toBe("one");
		expect(pluralCategory("pt-BR", 2)).toBe("other");
	});

	it("Russian: one, few, many", () => {
		expect(pluralCategory("ru", 1)).toBe("one");
		expect(pluralCategory("ru", 21)).toBe("one");
		expect(pluralCategory("ru", 11)).toBe("many");
		expect(pluralCategory("ru", 3)).toBe("few");
		expect(pluralCategory("ru", 13)).toBe("many");
		expect(pluralCategory("ru", 5)).toBe("many");
		expect(pluralCategory("ru", 1.5)).toBe("other");
	});
});

describe("installPluralRules", () => {
	it("fills in a missing Intl.PluralRules and leaves a present one alone", () => {
		const bare = {} as typeof Intl;
		installPluralRules(bare);
		expect(new bare.PluralRules("en").select(1)).toBe("one");
		expect(new bare.PluralRules("en", { type: "ordinal" }).select(1)).toBe(
			"other",
		);
		const own = { PluralRules: class {} } as unknown as typeof Intl;
		installPluralRules(own);
		expect(own.PluralRules.name).toBe("PluralRules");
	});
});
