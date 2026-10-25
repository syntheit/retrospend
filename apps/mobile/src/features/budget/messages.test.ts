import { loadMessages, SUPPORTED_LOCALES } from "@/lib/i18n";

// Budget and Wealth words live in mobile.budget and mobile.wealth. A locale
// that drops a key falls back to English silently, and one that renames a
// {placeholder} prints it raw, so both are checked here.

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): Map<string, string> {
	const out = new Map<string, string>();
	for (const [key, value] of Object.entries(tree)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === "string") out.set(path, value);
		else for (const [p, v] of leaves(value, path)) out.set(p, v);
	}
	return out;
}

/** The {names} a message takes, from simple placeholders and plural heads. */
function placeholders(message: string): string[] {
	const names = new Set<string>();
	for (const match of message.matchAll(/\{(\w+)(?:,[^{}]*)?[{}]/g)) {
		if (match[1]) names.add(match[1]);
	}
	return [...names].sort();
}

const english = loadMessages("en").mobile as unknown as Record<string, Tree>;

describe.each(["budget", "wealth"])("mobile.%s messages", (namespace) => {
	const base = leaves(english[namespace] as Tree);

	it.each(SUPPORTED_LOCALES.filter((l) => l !== "en"))(
		"%s has every key and the same placeholders",
		(locale) => {
			const mine = leaves(
				(loadMessages(locale).mobile as unknown as Record<string, Tree>)[
					namespace
				] as Tree,
			);
			expect([...mine.keys()].sort()).toEqual([...base.keys()].sort());
			for (const [path, message] of mine) {
				expect({ path, names: placeholders(message) }).toEqual({
					path,
					names: placeholders(base.get(path) ?? ""),
				});
			}
		},
	);

	it("English has no em dash", () => {
		for (const message of base.values()) expect(message).not.toContain("\u2014");
	});
});
