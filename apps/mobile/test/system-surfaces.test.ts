/**
 * @jest-environment node
 */
import fs from "node:fs";
import path from "node:path";
import config, { APP_LOCALES } from "../app.config";

const {
	addSendFilters,
	SHARE_RULE,
	STRING_TABLES,
	stringCatalog,
	swiftSources,
	TARGETS,
} = require("../plugins/with-system-surfaces");

interface Filter {
	action?: { $: Record<string, string> }[];
	data?: { $: Record<string, string> }[];
}
interface Manifest {
	manifest: {
		application: { activity: { "intent-filter": Filter[] }[] }[];
	};
}

function manifest(): Manifest {
	return {
		manifest: {
			application: [
				{
					activity: [
						{
							$: { "android:name": ".MainActivity" },
							"intent-filter": [
								{ data: [{ $: { "android:scheme": "retrospend" } }] },
							],
						},
					],
				},
			],
		},
	} as unknown as Manifest;
}

const filtersOf = (m: Manifest) =>
	m.manifest.application[0]?.activity[0]?.["intent-filter"] ?? [];

describe("system surfaces plugin", () => {
	it("is registered with the App Group", () => {
		const entry = (config.plugins ?? []).find(
			(p) => Array.isArray(p) && p[0] === "./plugins/with-system-surfaces",
		);
		expect(entry).toEqual([
			"./plugins/with-system-surfaces",
			{ appGroup: "group.app.retrospend", locales: APP_LOCALES },
		]);
	});

	it("accepts images, PDFs and text on the main activity, once", () => {
		const m = addSendFilters(addSendFilters(manifest()));
		const sends = filtersOf(m).filter((f) => f.action);
		expect(sends.map((f) => f.data?.[0]?.$)).toEqual([
			{ "android:mimeType": "image/*" },
			{ "android:mimeType": "application/pdf" },
			{ "android:mimeType": "text/plain" },
		]);
		expect(sends[0]?.action?.[0]?.$["android:name"]).toBe(
			"android.intent.action.SEND",
		);
		// The deep link filter stays.
		expect(filtersOf(m)).toHaveLength(4);
	});

	it("gives each iOS extension its own bundle id under the app's", () => {
		const bundle = config.ios?.bundleIdentifier;
		expect(
			TARGETS.map((t: { suffix: string }) => `${bundle}.${t.suffix}`),
		).toEqual(["app.retrospend.share", "app.retrospend.controls"]);
	});

	it("offers the share extension for images, PDFs and text only", () => {
		for (const uti of ["public.image", "com.adobe.pdf", "public.plain-text"]) {
			expect(SHARE_RULE).toContain(`"${uti}"`);
		}
		expect(SHARE_RULE).not.toMatch(/TRUEPREDICATE/);
	});

	it("translates the Shortcuts phrases into every app language", () => {
		const catalog = JSON.parse(stringCatalog("AppShortcuts", APP_LOCALES));
		const phrases = Object.entries(catalog.strings) as [
			string,
			{ localizations: Record<string, { stringUnit: { value: string } }> },
		][];
		expect(phrases.map(([key]) => key)).toEqual([
			"Add an expense in ${applicationName}",
			"New expense in ${applicationName}",
		]);
		for (const [, { localizations }] of phrases) {
			expect(Object.keys(localizations).sort()).toEqual(
				APP_LOCALES.filter((l) => l !== "en").sort(),
			);
			// Siri needs the app's name in every phrase.
			for (const { stringUnit } of Object.values(localizations)) {
				expect(stringUnit.value).toContain("${applicationName}");
			}
		}
		expect(phrases[0]?.[1].localizations["es-AR"]?.stringUnit.value).toBe(
			"Agregá un gasto en ${applicationName}",
		);
	});

	it("keys the String Catalogs by the English the Swift sources say", () => {
		const dir = path.join(__dirname, "../plugins/system-surfaces");
		const swift = [
			"AddExpenseIntent.swift",
			"RetrospendShortcuts.swift",
			"RetrospendControls.swift",
		]
			.map((file) => fs.readFileSync(path.join(dir, file), "utf8"))
			.join("\n");
		const sources = swiftSources() as Record<string, string>;
		const keys = Object.values(
			STRING_TABLES as Record<string, string[]>,
		).flat();
		for (const key of keys) {
			expect(swift).toContain(`"${sources[key]}"`);
		}
		const localizable = JSON.parse(stringCatalog("Localizable", APP_LOCALES));
		expect(Object.keys(localizable.strings)).toContain("Add expense ${amount}");
	});

	it("ships every Swift source the plugin copies", () => {
		const dir = path.join(__dirname, "../plugins/system-surfaces");
		const wanted = new Set([
			"AddExpenseIntent.swift",
			"RetrospendShortcuts.swift",
			...TARGETS.flatMap((t: { files: string[] }) => t.files),
		]);
		for (const file of wanted) {
			expect(fs.existsSync(path.join(dir, file as string))).toBe(true);
		}
	});
});
