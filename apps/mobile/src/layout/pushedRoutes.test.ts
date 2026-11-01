import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
	pushedHeader,
	SETTINGS_SCREENS,
	tabsScreenOptions,
} from "./pushedHeader";

// Every pushed screen (not a tab root) shows the system back button: the iOS
// chevron with the previous title or "Back", the Android Material 3 up arrow.
// The system draws it when the screen has a header and something under it in
// its stack, so this lists the pushed routes and checks both.

const APP = join(__dirname, "../../app");
const SRC = join(__dirname, "..");

function files(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return files(path);
		return /\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

const routes = files(APP).map((path) => relative(APP, path));

/** Route files under one tab folder: `index.tsx` is its root, the rest are pushed. */
function tabFolders(): Record<string, { layout: string; pushed: string[] }> {
	const tabs: Record<string, { layout: string; pushed: string[] }> = {};
	for (const route of routes) {
		const match = /^\(tabs\)\/([^/]+)\/(.+)$/.exec(route);
		if (!match) continue;
		const [, tab = "", rest = ""] = match;
		tabs[tab] ??= { layout: "", pushed: [] };
		const entry = tabs[tab];
		if (rest === "_layout.tsx") entry.layout = route;
		else if (rest !== "index.tsx") entry.pushed.push(route);
	}
	return tabs;
}

describe("pushed screens have the back button", () => {
	it("lists the pushed routes of the tabs", () => {
		const pushed = Object.values(tabFolders()).flatMap((t) => t.pushed);
		expect(pushed.sort()).toEqual(
			[
				"(tabs)/activity/[id].tsx",
				"(tabs)/home/insights.tsx",
				"(tabs)/people/[type]/[id].tsx",
				"(tabs)/people/project/[id].tsx",
				"(tabs)/projects/[id].tsx",
				"(tabs)/wealth/[id].tsx",
			].sort(),
		);
	});

	it("keeps every tab stack on the system header with the list as anchor", () => {
		for (const { layout } of Object.values(tabFolders())) {
			expect(layout).not.toBe("");
			const source = readFileSync(join(APP, layout), "utf8");
			// TabStack is the native stack with its default back button.
			expect(source).toContain("<TabStack");
			// A link into a pushed page still has the list under it.
			expect(source).toMatch(/unstable_settings\s*=\s*{\s*anchor:\s*"index"/);
		}
	});

	it("puts every Settings page in the root stack, with a header", () => {
		const settings = routes
			.filter((route) => route.startsWith("settings/"))
			.map((route) => route.replace(/\.tsx?$/, ""))
			.sort();
		// A layout of its own would make the first page a stack root: no back.
		expect(settings).not.toContain("settings/_layout");
		expect(SETTINGS_SCREENS.map((s) => s.name).sort()).toEqual(settings);
		const header = pushedHeader({ bg: "#000", fg: "#fff" }, false);
		expect(header.headerShown).toBe(true);
		expect(header).not.toHaveProperty("headerBackVisible");
		expect(header).not.toHaveProperty("headerLeft");
	});

	it("opens the same Settings pages inside the account sheet", () => {
		const inSheet = routes
			.filter((route) => route.startsWith("account/"))
			.map((route) => route.replace(/\.tsx?$/, ""))
			.sort();
		expect(inSheet).toContain("account/_layout");
		expect(inSheet).toContain("account/index");
		// Every page the sheet lists is a re-export of the page Settings pushes.
		const pages = SETTINGS_SCREENS.map((s) => s.name)
			.filter((n) => !["settings/search", "settings/inbox", "settings/recurring"].includes(n))
			.map((n) => `account/${n.replace(/^settings\//, "").replace(/^index$/, "settings")}`);
		for (const page of pages) expect(inSheet).toContain(page);
		const layout = readFileSync(join(APP, "account/_layout.tsx"), "utf8");
		expect(layout).toMatch(/unstable_settings\s*=\s*{\s*anchor:\s*"index"/);
		const root = readFileSync(join(APP, "_layout.tsx"), "utf8");
		expect(root).toMatch(/name="account"\s+options=\{accountSheetOptions\(\)\}/);
	});

	it("never hides the back button or swaps it for a drawn one", () => {
		const offenders: string[] = [];
		for (const path of [...files(APP), ...files(SRC)]) {
			if (/\.test\.tsx?$/.test(path)) continue;
			const source = readFileSync(path, "utf8");
			if (/headerBackVisible:\s*false|headerBackButtonMenuEnabled/.test(source))
				offenders.push(`${relative(SRC, path)}: headerBackVisible`);
			if (/headerLeft\b/.test(source))
				offenders.push(`${relative(SRC, path)}: headerLeft`);
		}
		expect(offenders).toEqual([]);
	});

	// The back button of Settings read "(tabs)", the route group's name, because
	// the tabs screen had no title for the system to label it with.
	it("titles the tabs screen so the back button never reads the route name", () => {
		expect(tabsScreenOptions("Back").title).toBe("Back");
		const layout = readFileSync(join(APP, "_layout.tsx"), "utf8");
		expect(layout).toMatch(
			/<Stack\.Screen\s+name="\(tabs\)"\s+options=\{tabsScreenOptions\(back\)\}/,
		);
		expect(layout).toContain('useTranslations("mobile.common")("back")');
	});

	it("hides a header only on the root screens and the list-detail pair", () => {
		const hidden = [...files(APP), ...files(SRC)]
			.filter((path) => !/\.test\.tsx?$/.test(path))
			.filter((path) => /headerShown:\s*false/.test(readFileSync(path, "utf8")))
			.map((path) => relative(SRC, path))
			.sort();
		expect(hidden).toEqual([
			"../app/_layout.tsx",
			"layout/pushedHeader.ts",
			"layout/useSettingsScreens.tsx",
			"ui/TopBar.android.tsx",
			"ui/TopBar.ios.tsx",
		]);
	});
});
