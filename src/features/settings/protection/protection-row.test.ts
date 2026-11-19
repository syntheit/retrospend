// The Security row's view states, server-rendered (the repo has no DOM test
// setup): hidden until the server says it offers protection, then loading,
// could not load, off, off with the email unverified, and keys ready.
import protection from "@retrospend/i18n/messages/en/protection.json";
import { createElement as h } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "~/components/ui/__tests__/render";

type Flags = { data?: { advancedProtection: boolean } };
type Status = {
	isPending: boolean;
	isError: boolean;
	data?: "none" | "keyed";
	refetch: () => void;
};

const state = vi.hoisted(() => ({
	flags: {} as { data?: { advancedProtection: boolean } },
	status: {} as {
		isPending: boolean;
		isError: boolean;
		data?: "none" | "keyed";
		refetch: () => void;
	},
	user: undefined as
		| {
				id: string;
				email: string;
				emailVerified: boolean;
				twoFactorEnabled: boolean;
		  }
		| undefined,
}));

vi.mock("~/trpc/react", () => ({
	api: { system: { getFeatureFlags: { useQuery: () => state.flags } } },
}));
vi.mock("@tanstack/react-query", () => ({
	useQuery: () => state.status,
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("~/hooks/use-session", () => ({
	useSession: () => ({ data: state.user ? { user: state.user } : null }),
}));
vi.mock("~/components/ui/toast", () => ({
	useToast: () => ({ saved: vi.fn() }),
}));
vi.mock("./enable-sheet", () => ({
	EnableSheet: () => h("div", { "data-sheet": "" }),
}));

const { ProtectionRow } = await import("./protection-row");
const row = protection.row;

const user = {
	id: "u1",
	email: "ana@example.com",
	emailVerified: true,
	twoFactorEnabled: false,
};
const setup = (flags: Flags, status: Partial<Status>, who = user) => {
	state.flags = flags;
	state.status = {
		isPending: false,
		isError: false,
		refetch: vi.fn(),
		...status,
	};
	state.user = who;
};
const html = () => render(h("ul", null, h(ProtectionRow)));
const words = (s: string) => s.replaceAll("&#x27;", "'");

beforeEach(() =>
	setup({ data: { advancedProtection: true } }, { data: "none" }),
);

describe("ProtectionRow", () => {
	it("draws nothing until the flags have loaded, and nothing when protection is not offered", () => {
		setup({}, { data: "none" });
		expect(html()).toBe("<ul></ul>");
		setup({ data: { advancedProtection: false } }, { data: "none" });
		expect(html()).toBe("<ul></ul>");
	});

	it("draws nothing without a signed-in account", () => {
		state.user = undefined;
		expect(html()).toBe("<ul></ul>");
	});

	it("shows a skeleton while the keys status loads, with no button", () => {
		setup({ data: { advancedProtection: true } }, { isPending: true });
		const out = words(html());
		expect(out).toContain(row.title);
		expect(out).toContain("animate-pulse");
		expect(out).not.toContain(row.turnOn);
	});

	it("says it could not load and offers Try again", () => {
		setup({ data: { advancedProtection: true } }, { isError: true });
		const out = words(html());
		expect(out).toContain(row.loadFailed);
		expect(out).toContain(row.retry);
		expect(out).not.toContain(row.turnOn);
	});

	it("is Off with Turn on for an account without keys", () => {
		const out = words(html());
		expect(out).toContain(row.off);
		expect(out).toContain(`>${row.turnOn}</button>`);
		expect(out).not.toContain('disabled=""');
		expect(out).toContain("data-sheet");
	});

	it("disables Turn on and gives the reason when the email is not verified", () => {
		setup(
			{ data: { advancedProtection: true } },
			{ data: "none" },
			{ ...user, emailVerified: false },
		);
		const out = words(html());
		expect(out).toContain(row.verifyEmailFirst);
		expect(out).toMatch(
			new RegExp(`<button[^>]*disabled=""[^>]*>${row.turnOn}`),
		);
	});

	it("says keys are ready, with no Turn on and no sheet, once the account has them", () => {
		setup({ data: { advancedProtection: true } }, { data: "keyed" });
		const out = words(html());
		expect(out).toContain(row.keysReady);
		expect(out).not.toContain(row.turnOn);
		expect(out).not.toContain("data-sheet");
	});
});
