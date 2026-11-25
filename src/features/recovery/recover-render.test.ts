// Server-rendered markup of the recovery steps, the choices and the error line
// (the repo has no DOM test setup, so this is as far as a view state can be
// checked without a browser; what it cannot reach is the Sheet itself, focus
// moving to the next group, and what a real paste does: the e2e flow covers
// those).
import protection from "@retrospend/i18n/messages/en/protection.json";
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { render } from "~/components/ui/__tests__/render";
import { initialState, type RecoverState } from "./recover-model";
import { EnterKeyStep, NewPasswordStep } from "./recover-steps";
import { RecoveryChoices } from "./recovery-choices";
import { RecoveryError } from "./recovery-error";

const p = protection;
const KEY = "000G40-R40M30-E20918-5GR38E-1W8124-GK2GAH-C5RR34-D1P70X-3RFH8K";
const words = (html: string) =>
	html
		.replaceAll("&#x27;", "'")
		.replaceAll("&amp;", "&")
		.replaceAll("&quot;", '"');
const state = (patch: Partial<RecoverState>): RecoverState => ({
	...initialState(),
	...patch,
});
const enter = (patch: Partial<RecoverState>, locked = false) =>
	words(
		render(
			h(EnterKeyStep, { state: state(patch), dispatch: () => {}, locked }),
		),
	);
const password = (patch: Partial<RecoverState>, locked = false) =>
	words(
		render(
			h(NewPasswordStep, {
				state: state({ step: "password", ...patch }),
				dispatch: () => {},
				locked,
			}),
		),
	);

describe("the key step", () => {
	it("is nine inputs named Group 1 to Group 9, holding what was typed", () => {
		const html = enter({ groups: KEY.split("-") });
		for (let n = 1; n <= 9; n++)
			expect(html).toContain(`aria-label="Group ${n}"`);
		expect(html.match(/<input/g)?.length).toBe(9);
		for (const group of KEY.split("-"))
			expect(html).toContain(`value="${group}"`);
		expect(html).toContain(p.recover.enterBody);
		// No browser help for a secret: no autofill, no autocorrect, no spellcheck.
		expect(html.match(/autoComplete="off"/g)?.length).toBe(9);
		expect(html.match(/spellCheck="false"/g)?.length).toBe(9);
	});

	it("limits each input to one group", () => {
		expect(enter({}).match(/maxLength="6"/g)?.length).toBe(9);
	});

	it("locks the inputs while it works and after a blocking failure", () => {
		expect(enter({}, true).match(/disabled=""/g)?.length).toBe(9);
		expect(enter({}).match(/disabled=""/g)).toBeNull();
	});

	it("says a typo as one line under the groups, an alert", () => {
		const html = enter({ error: "typo" });
		expect(html).toContain('role="alert"');
		expect(html).toContain(p.recover.errors.typo);
	});

	it("says a wrong key the same way", () => {
		expect(enter({ error: "wrongKey" })).toContain(p.recover.errors.wrongKey);
	});

	it("says an account with no recovery key as the sheet's one Notice, not an alert line", () => {
		const html = enter({ error: "unavailable" }, true);
		expect(html).toContain(p.recover.errors.unavailable);
		expect(html).toContain('data-tone="danger"');
		expect(html).not.toContain('<p class="text-danger');
	});

	it("shows nothing when there is no failure", () => {
		const html = enter({});
		for (const line of Object.values(p.recover.errors))
			expect(html).not.toContain(line);
	});
});

describe("the new password step", () => {
	it("asks twice and lights the rules", () => {
		const html = password({ password: "Abcdef12" });
		expect(html).toContain("New password");
		expect(html).toContain("Confirm new password");
		expect(html).toContain("8 or more characters");
		expect(html.split('autoComplete="new-password"').length - 1).toBe(2);
		expect(html).toContain(p.recover.newPasswordBody);
	});

	it("says when the two do not match", () => {
		expect(password({ password: "Abcdef12", confirm: "Abcdef1" })).toContain(
			"The new passwords don't match",
		);
		expect(password({ password: "Abcdef12" })).not.toContain("don't match");
	});

	it("says it is setting the password only while it is, and locks the fields", () => {
		const busy = password({ busy: true }, true);
		expect(busy).toContain(p.recover.saving);
		expect(busy).toContain('role="status"');
		expect(busy.match(/disabled=""/g)?.length).toBe(2);
		expect(password({})).not.toContain(p.recover.saving);
	});

	it("shows a failure that can be tried again as an alert", () => {
		const html = password({ error: "failed" });
		expect(html).toContain('role="alert"');
		expect(html).toContain(p.recover.errors.failed);
	});
});

describe("the choices", () => {
	const choices = (protectionOn: boolean) =>
		words(
			render(
				h(RecoveryChoices, {
					protectionOn,
					onUseKey: () => {},
					onReset: () => {},
				}),
			),
		);

	it("with protection on, leads with Use key and gives the other two their reason, with no way to reset by email", () => {
		const html = choices(true);
		expect(html).toContain(p.recover.choose.titleOn);
		expect(html).toContain(p.recover.choose.bodyOn);
		expect(html).toContain(`>${p.recover.choose.useKey}</button>`);
		expect(html).toContain(p.methods.device);
		expect(html).toContain(p.recover.choose.nothingWorks);
		expect(html.split(p.methods.reason).length - 1).toBe(2);
		expect(html).not.toContain(p.recover.choose.reset);
		expect(html.match(/<button/g)?.length).toBe(1);
	});

	it("with protection off, Use key and today's reset, which says it removes the keys", () => {
		const html = choices(false);
		expect(html).toContain(p.recover.choose.titleOff);
		expect(html).toContain(`>${p.recover.choose.useKey}</button>`);
		expect(html).toContain(`>${p.recover.choose.reset}</button>`);
		expect(html).toContain(p.recover.choose.resetMeta);
		// Another device still gives its reason.
		expect(html.split(p.methods.reason).length - 1).toBe(1);
	});
});

describe("the error line", () => {
	const line = (code: Parameters<typeof RecoveryError>[0]["code"]) =>
		words(render(h(RecoveryError, { code })));

	it("is empty without a failure", () => {
		expect(line(null)).toBe("");
	});

	it("is an alert line for a failure that can be tried again", () => {
		for (const code of [
			"typo",
			"wrongKey",
			"tooMany",
			"failed",
			"wrongPassword",
			"keysChanged",
		] as const) {
			const html = line(code);
			expect(html, code).toContain(
				'<p class="text-danger text-small" role="alert">',
			);
			expect(html, code).not.toContain("data-tone");
			expect(html, code).toContain(p.recover.errors[code]);
		}
	});

	it("is the Notice for a failure nothing can fix on this screen", () => {
		for (const code of [
			"linkExpired",
			"notOffered",
			"notSaved",
			"unavailable",
		] as const) {
			const html = line(code);
			expect(html, code).toContain('data-tone="danger"');
			expect(html, code).not.toContain('<p class="text-danger');
			expect(html, code).toContain(p.recover.errors[code]);
		}
	});
});
