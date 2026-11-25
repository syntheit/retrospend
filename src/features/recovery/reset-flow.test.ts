// What the reset page shows for each answer of the link check, server-rendered
// (the repo has no DOM test setup). The case that matters: a link the recovery
// check does not know (404) is shown the plain reset form, not "Invalid link",
// because an admin's link is unknown to the check and still resets a password
// of an account without keys. The server judges the token at submit.
import protection from "@retrospend/i18n/messages/en/protection.json";
import { createElement as h } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "~/components/ui/__tests__/render";

type Link = {
	isPending: boolean;
	isError: boolean;
	data?:
		| "invalid"
		| { keys: "none" | "recovery" | "noRecovery"; protectionOn: boolean };
	refetch: () => void;
};
const state = vi.hoisted(() => ({ link: {} as unknown }));

vi.mock("@tanstack/react-query", () => ({ useQuery: () => state.link }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("~/components/ui/toast", () => ({
	useToast: () => ({ saved: vi.fn(), info: vi.fn() }),
}));
vi.mock("~/trpc/react", () => ({
	api: {
		auth: {
			resetPassword: {
				useMutation: () => ({ isPending: false, mutate: vi.fn() }),
			},
		},
	},
}));
vi.mock("~/lib/protection/recovery", () => ({
	checkRecoveryLink: vi.fn(),
	webRecoveryCallbacks: () => ({ begin: vi.fn(), finish: vi.fn() }),
}));
vi.mock("./recover-sheet", () => ({
	RecoverSheet: () => h("div", { "data-recover-sheet": "" }),
}));

const { ResetFlow } = await import("./reset-flow");
const set = (patch: Partial<Link>) => {
	state.link = { isPending: false, isError: false, refetch: vi.fn(), ...patch };
};
const html = () =>
	render(h(ResetFlow, { token: "t" }))
		.replaceAll("&#x27;", "'")
		.replaceAll("&amp;", "&");
const PLAIN_TITLE = "Set new password";

beforeEach(() => set({ isPending: true }));

describe("ResetFlow", () => {
	it("shows the plain form for a link the recovery check does not know, never Invalid link", () => {
		set({ data: "invalid" });
		const out = html();
		expect(out).toContain(PLAIN_TITLE);
		expect(out).toContain('id="password"');
		expect(out).not.toContain("Invalid link");
		expect(out).not.toContain("data-recover-sheet");
	});

	it("shows the plain form for an account without keys", () => {
		set({ data: { keys: "none", protectionOn: false } });
		expect(html()).toContain(PLAIN_TITLE);
	});

	it("shows the choices and the recovery sheet for an account with keys", () => {
		set({ data: { keys: "recovery", protectionOn: true } });
		const out = html();
		expect(out).toContain(protection.recover.choose.titleOn);
		expect(out).toContain("data-recover-sheet");
		expect(out).not.toContain('id="password"');
	});

	it("never shows the plain form on a guess when the link could not be checked", () => {
		set({ isError: true });
		const out = html();
		expect(out).toContain(protection.recover.linkFailed);
		expect(out).toContain(protection.row.retry);
		expect(out).not.toContain(PLAIN_TITLE);
	});

	it("shows a skeleton, not a form, while the link is checked", () => {
		const out = html();
		expect(out).toContain("animate-pulse");
		expect(out).not.toContain(PLAIN_TITLE);
	});
});
