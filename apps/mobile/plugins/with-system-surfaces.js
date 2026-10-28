// System surfaces: share into Retrospend, Quick Settings, Shortcuts, Controls.
//
// Android: SEND intent filters on the main activity (the Quick Settings tile
// and the share reader live in modules/surfaces and merge their own manifest).
//
// iOS, three pieces, all handing off through one App Group (plugins/
// system-surfaces/*.swift are the sources):
//   - the app target gets the App Intents (Shortcuts, Spotlight) and the
//     group entitlement;
//   - RetrospendShare, a share extension (receipt image or PDF, or text);
//   - RetrospendControls, a WidgetKit extension with one iOS 18 Control,
//     "Add expense", for Control Center and the lock screen.
// Each extension is its own App ID, so the App Group and the two bundle ids
// must exist in the Apple developer account (automatic signing creates the
// profiles).
const fs = require("node:fs");
const path = require("node:path");
const {
	IOSConfig,
	withAndroidManifest,
	withDangerousMod,
	withEntitlementsPlist,
	withInfoPlist,
	withXcodeProject,
} = require("expo/config-plugins");

const SOURCES = path.join(__dirname, "system-surfaces");

// ---- Android ----------------------------------------------------------

const SEND_TYPES = ["image/*", "application/pdf", "text/plain"];

/** The ACTION_SEND filters, one per MIME type, as manifest objects. */
function sendFilters() {
	return SEND_TYPES.map((mimeType) => ({
		action: [{ $: { "android:name": "android.intent.action.SEND" } }],
		category: [{ $: { "android:name": "android.intent.category.DEFAULT" } }],
		data: [{ $: { "android:mimeType": mimeType } }],
	}));
}

/** Adds the SEND filters to the main activity of a parsed manifest, once. */
function addSendFilters(manifest) {
	const activity = manifest.manifest.application?.[0]?.activity?.find(
		(a) => a.$["android:name"] === ".MainActivity",
	);
	if (!activity) throw new Error("AndroidManifest has no .MainActivity");
	activity["intent-filter"] = activity["intent-filter"] ?? [];
	const filters = activity["intent-filter"];
	for (const filter of sendFilters()) {
		const type = filter.data[0].$["android:mimeType"];
		const has = filters.some((f) =>
			f.data?.some((d) => d.$["android:mimeType"] === type),
		);
		if (!has) filters.push(filter);
	}
	return manifest;
}

function withShareTarget(config) {
	return withAndroidManifest(config, (mod) => {
		addSendFilters(mod.modResults);
		return mod;
	});
}

// ---- iOS --------------------------------------------------------------

const GROUP_KEY = "com.apple.security.application-groups";

const plistValue = (value) =>
	typeof value === "string"
		? `<string>${value.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</string>`
		: "";

/** A flat plist from string values, plus raw XML for nested ones (`raw`). */
function plist(entries, raw = "") {
	const body = Object.entries(entries)
		.map(([k, v]) => `\t<key>${k}</key>\n\t${plistValue(v)}`)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
${raw}</dict>
</plist>
`;
}

function groupEntitlements(group) {
	return plist(
		{},
		`\t<key>${GROUP_KEY}</key>\n\t<array>\n\t\t<string>${group}</string>\n\t</array>\n`,
	);
}

// Offered for a receipt image, a PDF, or text. A predicate, not the simple
// dictionary, because PDFs arrive as files and the dictionary has no PDF key.
const SHARE_RULE = `SUBQUERY (extensionItems, $extensionItem, SUBQUERY ($extensionItem.attachments, $attachment, ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.image" || ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "com.adobe.pdf" || ANY $attachment.registeredTypeIdentifiers UTI-CONFORMS-TO "public.plain-text").@count >= 1).@count >= 1`;

function extensionPlist({ name, group, version, build, point, extra }) {
	const common = {
		CFBundleDevelopmentRegion: "en",
		CFBundleDisplayName: name,
		CFBundleExecutable: "$(EXECUTABLE_NAME)",
		CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
		CFBundleInfoDictionaryVersion: "6.0",
		CFBundleName: "$(PRODUCT_NAME)",
		CFBundlePackageType: "XPC!",
		CFBundleShortVersionString: version,
		CFBundleVersion: build,
		RetrospendAppGroup: group,
	};
	return plist(
		common,
		`\t<key>NSExtension</key>\n\t<dict>\n${extra}\t\t<key>NSExtensionPointIdentifier</key>\n\t\t<string>${point}</string>\n\t</dict>\n`,
	);
}

// ---- iOS strings --------------------------------------------------------
//
// The Shortcuts phrases and the intent's and Control's words come from the
// "shortcuts" section of the mobile catalogs (packages/i18n), written as
// String Catalogs Xcode compiles into each language. The Swift sources keep
// the English text, which is each string's key.

const MESSAGES = path.join(
	__dirname,
	"..",
	"..",
	"..",
	"packages",
	"i18n",
	"messages",
);

/** Catalog keys per String Catalog table. AppShortcuts holds Siri's phrases. */
const STRING_TABLES = {
	AppShortcuts: ["phraseAdd", "phraseNew"],
	Localizable: ["addExpense", "description", "amount", "summary"],
};

/** ICU arguments as the String Catalog key writes the Swift interpolation. */
const CATALOG_ARGS = { app: "${applicationName}", amount: "${amount}" };

/** ICU arguments as the Swift source writes them. */
const SWIFT_ARGS = { app: "\\(.applicationName)", amount: "\\(\\.$amount)" };

function withArgs(text, args) {
	return text.replace(/\{(\w+)\}/g, (whole, name) => args[name] ?? whole);
}

/** The "shortcuts" section of one locale's mobile catalog. */
function shortcutStrings(locale) {
	const file = path.join(MESSAGES, locale, "mobile.json");
	const strings = JSON.parse(fs.readFileSync(file, "utf8")).shortcuts;
	if (!strings) throw new Error(`${file} has no "shortcuts" section`);
	return strings;
}

/** One .xcstrings file (JSON): English keys, every other locale translated. */
function stringCatalog(table, locales) {
	const english = shortcutStrings("en");
	const others = locales
		.filter((l) => l !== "en")
		.map((l) => [l, shortcutStrings(l)]);
	const strings = {};
	for (const key of STRING_TABLES[table]) {
		const localizations = {};
		for (const [locale, catalog] of others) {
			if (!catalog[key]) continue;
			localizations[locale] = {
				stringUnit: {
					state: "translated",
					value: withArgs(catalog[key], CATALOG_ARGS),
				},
			};
		}
		strings[withArgs(english[key], CATALOG_ARGS)] = { localizations };
	}
	return `${JSON.stringify({ sourceLanguage: "en", strings, version: "1.0" }, null, 2)}\n`;
}

/** What the Swift sources must say for each catalog key (the English text). */
function swiftSources() {
	const english = shortcutStrings("en");
	return Object.fromEntries(
		Object.values(STRING_TABLES)
			.flat()
			.map((key) => [key, withArgs(english[key], SWIFT_ARGS)]),
	);
}

const TARGETS = [
	{
		name: "RetrospendShare",
		suffix: "share",
		files: ["ShareViewController.swift"],
		deployment: "16.4",
		plist: (p) =>
			extensionPlist({
				...p,
				name: "Retrospend",
				point: "com.apple.share-services",
				extra: `\t\t<key>NSExtensionAttributes</key>\n\t\t<dict>\n\t\t\t<key>NSExtensionActivationRule</key>\n\t\t\t<string>${SHARE_RULE.replace(/"/g, "&quot;")}</string>\n\t\t</dict>\n\t\t<key>NSExtensionPrincipalClass</key>\n\t\t<string>$(PRODUCT_MODULE_NAME).ShareViewController</string>\n`,
			}),
	},
	{
		name: "RetrospendControls",
		suffix: "controls",
		// The intent is compiled into the extension too: a Control names the
		// intent type, and the system runs it in the app (openAppWhenRun).
		files: ["RetrospendControls.swift", "AddExpenseIntent.swift"],
		// The Control's label and description, in the extension's own bundle.
		strings: ["Localizable"],
		deployment: "18.0",
		plist: (p) =>
			extensionPlist({
				...p,
				name: "Retrospend controls",
				point: "com.apple.widgetkit-extension",
				extra: "",
			}),
	},
];

function settingsOf(project, target) {
	const lists = project.pbxXCConfigurationList();
	const configs = project.pbxXCBuildConfigurationSection();
	const list = lists[target.pbxNativeTarget.buildConfigurationList];
	return list.buildConfigurations.map((c) => configs[c.value].buildSettings);
}

function addExtensionTarget(project, spec, ctx) {
	const { appId, team } = ctx;
	if (project.pbxTargetByName(spec.name)) return;
	const bundleId = `${appId}.${spec.suffix}`;
	const target = project.addTarget(
		spec.name,
		"app_extension",
		spec.name,
		bundleId,
	);
	const resources = (spec.strings ?? []).map((table) => `${table}.xcstrings`);
	const group = project.addPbxGroup(
		[...spec.files, ...resources, "Info.plist", `${spec.name}.entitlements`],
		spec.name,
		spec.name,
	);
	const mainGroup = project.getFirstProject().firstProject.mainGroup;
	project.addToPbxGroup(group.uuid, mainGroup);
	project.addBuildPhase(
		spec.files,
		"PBXSourcesBuildPhase",
		"Sources",
		target.uuid,
	);
	// The app builds the extensions first, then embeds them.
	project.addTargetDependency(project.getFirstTarget().uuid, [target.uuid]);
	project.addBuildPhase(
		resources,
		"PBXResourcesBuildPhase",
		"Resources",
		target.uuid,
	);
	project.addBuildPhase(
		[],
		"PBXFrameworksBuildPhase",
		"Frameworks",
		target.uuid,
	);
	for (const s of settingsOf(project, target)) {
		Object.assign(s, {
			INFOPLIST_FILE: `"${spec.name}/Info.plist"`,
			CODE_SIGN_ENTITLEMENTS: `"${spec.name}/${spec.name}.entitlements"`,
			CODE_SIGN_STYLE: "Automatic",
			SWIFT_VERSION: "5.0",
			IPHONEOS_DEPLOYMENT_TARGET: spec.deployment,
			TARGETED_DEVICE_FAMILY: '"1,2"',
			CURRENT_PROJECT_VERSION: ctx.build,
			MARKETING_VERSION: ctx.version,
			GENERATE_INFOPLIST_FILE: "NO",
			CLANG_ENABLE_MODULES: "YES",
			...(team ? { DEVELOPMENT_TEAM: team } : {}),
		});
	}
}

/** The String Catalogs the app target carries. */
const APP_STRINGS = ["AppShortcuts", "Localizable"];

/**
 * Types every String Catalog reference. The xcode package does not know the
 * extension: it leaves the type "unknown" (and writes undefined fields), so
 * Xcode would copy the JSON instead of compiling it.
 */
function typeStringCatalogs(project) {
	const refs = project.pbxFileReferenceSection();
	for (const ref of Object.values(refs)) {
		if (typeof ref !== "object" || !/\.xcstrings"?$/.test(String(ref.path))) {
			continue;
		}
		for (const key of Object.keys(ref)) {
			if (ref[key] === undefined) delete ref[key];
		}
		ref.lastKnownFileType = "text.json.xcstrings";
	}
}

function withIosSurfaces(config, group, locales) {
	const appId = config.ios?.bundleIdentifier;
	if (!appId) throw new Error("ios.bundleIdentifier is required");
	const version = config.version ?? "1.0.0";
	const build = String(config.ios?.buildNumber ?? "1");

	config = withEntitlementsPlist(config, (c) => {
		c.modResults[GROUP_KEY] = [group];
		return c;
	});
	config = withInfoPlist(config, (c) => {
		c.modResults.RetrospendAppGroup = group;
		return c;
	});
	// Sources and plists on disk.
	config = withDangerousMod(config, [
		"ios",
		(mod) => {
			const root = mod.modRequest.platformProjectRoot;
			const app = path.join(root, mod.modRequest.projectName);
			for (const file of [
				"AddExpenseIntent.swift",
				"RetrospendShortcuts.swift",
			]) {
				fs.copyFileSync(path.join(SOURCES, file), path.join(app, file));
			}
			for (const table of APP_STRINGS) {
				fs.writeFileSync(
					path.join(app, `${table}.xcstrings`),
					stringCatalog(table, locales),
				);
			}
			for (const spec of TARGETS) {
				const dir = path.join(root, spec.name);
				fs.mkdirSync(dir, { recursive: true });
				for (const file of spec.files) {
					fs.copyFileSync(path.join(SOURCES, file), path.join(dir, file));
				}
				for (const table of spec.strings ?? []) {
					fs.writeFileSync(
						path.join(dir, `${table}.xcstrings`),
						stringCatalog(table, locales),
					);
				}
				fs.writeFileSync(
					path.join(dir, "Info.plist"),
					spec.plist({ group, version, build }),
				);
				fs.writeFileSync(
					path.join(dir, `${spec.name}.entitlements`),
					groupEntitlements(group),
				);
			}
			return mod;
		},
	]);
	// Xcode project: the app's intent sources, then the two extension targets.
	return withXcodeProject(config, (mod) => {
		const project = mod.modResults;
		const name = mod.modRequest.projectName;
		for (const file of [
			"AddExpenseIntent.swift",
			"RetrospendShortcuts.swift",
		]) {
			IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
				filepath: `${name}/${file}`,
				groupName: name,
				project,
			});
		}
		for (const table of APP_STRINGS) {
			IOSConfig.XcodeUtils.addResourceFileToGroup({
				filepath: `${name}/${table}.xcstrings`,
				groupName: name,
				isBuildFile: true,
				project,
			});
		}
		for (const spec of TARGETS) {
			addExtensionTarget(project, spec, {
				appId,
				team: config.ios?.appleTeamId,
				version,
				build,
			});
		}
		typeStringCatalogs(project);
		for (const locale of locales) project.addKnownRegion(locale);
		return mod;
	});
}

module.exports = function withSystemSurfaces(config, props = {}) {
	const group = props.appGroup ?? `group.${config.ios?.bundleIdentifier}`;
	const locales = props.locales ?? ["en"];
	config = withShareTarget(config);
	return withIosSurfaces(config, group, locales);
};
module.exports.addSendFilters = addSendFilters;
module.exports.SHARE_RULE = SHARE_RULE;
module.exports.TARGETS = TARGETS;
module.exports.STRING_TABLES = STRING_TABLES;
module.exports.stringCatalog = stringCatalog;
module.exports.swiftSources = swiftSources;
