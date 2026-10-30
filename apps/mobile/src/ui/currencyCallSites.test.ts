import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Every place the app picks a currency uses the one CurrencyPicker: no plain
// dropdown (Picker, PickerRow) is fed a list of currencies.
const SRC = join(__dirname, "..");

function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sources(path);
		return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
	});
}

const read = (file: string) => readFileSync(join(SRC, file), "utf8");

/** Each screen that chooses a currency, and the markup that renders the picker. */
const CALL_SITES: { file: string; uses: string; what: string }[] = [
	{
		file: "features/entry/AmountCard.tsx",
		uses: "<CurrencyPicker",
		what: "composer amount: expense and income currency",
	},
	{
		file: "features/wealth/AccountSheet.tsx",
		uses: "<CurrencyPicker",
		what: "new account currency",
	},
	{
		file: "features/settings/PreferencesSection.tsx",
		uses: "<CurrencyRow",
		what: "home currency and default currency",
	},
	{
		file: "features/settings/parts.tsx",
		uses: "<CurrencyPicker",
		what: "the settings currency row",
	},
];

describe("currency choices", () => {
	it.each(CALL_SITES)(
		"$what renders CurrencyPicker ($file)",
		({ file, uses }) => {
			expect(read(file)).toContain(uses);
		},
	);

	it.each([
		"features/currencies/CurrenciesScreen.tsx",
		"features/currencies/CurrencySheet.tsx",
	])("%s shows the picker's flag (or coin) for each currency", (file) => {
		expect(read(file)).toContain("<CurrencyFlag");
	});

	it("settings has a picker for both home and default currency", () => {
		const prefs = read("features/settings/PreferencesSection.tsx");
		expect(prefs.match(/<CurrencyRow/g)).toHaveLength(2);
		expect(prefs).toContain('t("money.home")');
		expect(prefs).toContain('t("money.default")');
	});

	it("no plain dropdown is fed currencies", () => {
		const offenders = sources(SRC).filter((file) => {
			if (file.endsWith("ui/CurrencyPicker.tsx")) return false;
			const text = readFileSync(file, "utf8");
			// A Picker or PickerRow whose options come from currencies.
			return /<(Picker|PickerRow)\b[^>]*options=\{[^}]*(currenc|Currenc)/s.test(
				text,
			);
		});
		expect(offenders).toEqual([]);
	});
});
