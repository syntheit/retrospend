// Which shell renders: the dashboard layout and the project page both pick it
// from uiV2Mode for the viewer, and flag off renders today's shell unchanged.
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pass = ({ children }: { children?: ReactNode }) =>
	h("section", null, children);

vi.mock("~/components/dashboard-layout", () => ({
	DashboardLayout: ({ children }: { children: ReactNode }) =>
		h("div", { "data-shell": "legacy" }, children),
}));
vi.mock("~/components/command-palette", () => ({
	CommandPalette: () => h("i", { "data-palette": "legacy" }),
}));
vi.mock("~/components/shell/app-shell", () => ({
	AppShell: ({ children }: { children: ReactNode }) =>
		h("div", { "data-shell": "v2" }, children),
}));

// next/dynamic suspends on the server; resolve the loader up front instead
// (its promise settles before the tests run, after the awaited imports).
vi.mock("next/dynamic", () => ({
	default: (load: () => Promise<(p: object) => ReactNode>) => {
		let Loaded: ((p: object) => ReactNode) | null = null;
		void load().then((c) => {
			Loaded = c;
		});
		return (props: object) => (Loaded ? h(Loaded, props) : null);
	},
}));

const flag = vi.fn<(flag: string, viewer: unknown) => Promise<boolean>>();
const session = vi.fn();
vi.mock("~/server/flags", () => ({ isFlagEnabled: flag }));
vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: session } },
}));
vi.mock("~/server/db", () => ({
	db: { user: { findUnique: async () => ({ language: "en" }) } },
}));
vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
	redirect: () => {
		throw new Error("redirect");
	},
}));
vi.mock("~/trpc/server", () => ({
	HydrateClient: pass,
	api: { settings: { getGeneral: { prefetch: async () => {} } } },
}));
vi.mock("~/i18n/locale-sync", () => ({ LocaleSync: () => null }));
vi.mock("~/components/expense-modal-provider", () => ({
	ExpenseModalProvider: pass,
}));
vi.mock("~/components/recurring-modal-provider", () => ({
	RecurringModalProvider: pass,
}));
vi.mock("~/components/revision-history-provider", () => ({
	RevisionHistoryProvider: pass,
}));

const { ShellSwitch } = await import("../shell-switch");
const { ShellModeProvider } = await import("../shell-context");
const { default: DashboardRoot } = await import("~/app/(dashboard)/layout");
const { default: ProjectRoot } = await import("~/app/projects/[id]/layout");

const LEGACY =
	'<div data-shell="legacy">page</div><i data-palette="legacy"></i>';
const V2 = '<div data-shell="v2">page</div>';

const user = { id: "u1", role: "USER", isActive: true };

beforeEach(() => {
	flag.mockReset();
	session.mockReset();
	session.mockResolvedValue({ user });
});

describe("ShellSwitch (project page)", () => {
	const render = (mode?: "legacy" | "v2") =>
		renderToStaticMarkup(
			mode
				? h(ShellModeProvider, { mode, children: h(ShellSwitch, null, "page") })
				: h(ShellSwitch, null, "page"),
		);

	it("renders today's DashboardLayout and CommandPalette by default and when legacy", () => {
		expect(render()).toBe(LEGACY);
		expect(render("legacy")).toBe(LEGACY);
	});

	it("renders the new shell when the layout says v2", () => {
		expect(render("v2")).toBe(V2);
	});
});

describe("dashboard layout", () => {
	const render = async () =>
		renderToStaticMarkup(await DashboardRoot({ children: "page" }));

	it("flag off: today's shell, exactly", async () => {
		flag.mockResolvedValue(false);
		expect(await render()).toBe(
			`<section><section><section><section>${LEGACY}</section></section></section></section>`,
		);
		expect(flag).toHaveBeenCalledWith("uiV2", user);
	});

	it("flag on for this viewer: the new shell, no old palette", async () => {
		flag.mockResolvedValue(true);
		expect(await render()).toBe(
			`<section><section><section><section>${V2}</section></section></section></section>`,
		);
	});
});

describe("project layout", () => {
	// The layout only sets the mode; the page's ShellSwitch reads it.
	const render = async () =>
		renderToStaticMarkup(
			await ProjectRoot({ children: h(ShellSwitch, null, "page") }),
		);

	it("flag off or signed out: today's shell", async () => {
		flag.mockResolvedValue(false);
		expect(await render()).toBe(LEGACY);
		session.mockResolvedValue(null);
		flag.mockResolvedValue(true);
		expect(await render()).toBe(LEGACY);
	});

	it("a disabled account keeps today's shell", async () => {
		session.mockResolvedValue({ user: { ...user, isActive: false } });
		flag.mockResolvedValue(true);
		expect(await render()).toBe(LEGACY);
	});

	it("flag on for a signed-in viewer: the new shell", async () => {
		flag.mockResolvedValue(true);
		expect(await render()).toBe(V2);
	});
});
