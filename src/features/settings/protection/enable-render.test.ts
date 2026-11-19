// Server-rendered markup of the enable steps (the repo has no DOM test setup,
// so this is as far as a view state can be checked without a browser; what it
// cannot reach is listed in enable-sheet.tsx's callers: the Sheet itself,
// focus moving between steps, and the browser copy, file and print).
import protection from "@retrospend/i18n/messages/en/protection.json";
import { createElement as h, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "~/components/ui/__tests__/render";
import { EnableBody } from "./enable-body";
import { EnableFooter } from "./enable-footer";
import {
	ENABLE_STEPS,
	type EnableState,
	type EnableStep,
	enableView,
	INITIAL_STATE,
} from "./enable-model";
import type { KeyActions, KeyFile } from "./recovery-key-actions";

const KEY = "000G40-R40M30-E20918-5GR38E-1W8124-GK2GAH-C5RR34-D1P70X-3RFH8K";
const state = (patch: Partial<EnableState>): EnableState => ({
	...INITIAL_STATE,
	...patch,
});
const actions: KeyActions = {
	copy: vi.fn(async () => {}),
	download: vi.fn(),
	print: vi.fn(),
};
const file: KeyFile = {
	labels: { title: "T", account: "A", made: "M", key: "K", keepSafe: "S" },
	account: "ana@example.com",
	made: "2026-11-18",
};
const body = (
	patch: Partial<EnableState>,
	extra: { twoFactor?: boolean; onSeeWhich?: () => void } = {},
) =>
	render(
		h(EnableBody, {
			state: state(patch),
			dispatch: () => {},
			twoFactor: extra.twoFactor ?? false,
			onSeeWhich: extra.onSeeWhich,
			actions,
			file,
		}),
	);

/** Text of the markup with the escapes of the apostrophe and ampersand undone. */
const words = (html: string) =>
	html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&quot;", '"');

const p = protection;
const STEP_STATE: Record<EnableStep, Partial<EnableState>> = {
	what: {},
	newPassword: {},
	methods: {},
	saveKey: { keyText: KEY },
	confirmKey: { keyText: KEY, groups: [2, 6] },
	confirmYou: {},
	done: {},
};

describe("the done step", () => {
	it("shows the interim notice, and no other step does", () => {
		for (const step of ENABLE_STEPS) {
			const html = words(body({ step, ...STEP_STATE[step] }));
			if (step === "done") expect(html).toContain(p.enable.notice);
			else expect(html, step).not.toContain(p.enable.notice);
		}
	});

	it("the notice is a status line", () => {
		expect(body({ step: "done" })).toContain('role="status"');
	});

	it("is closed by Done and has no way back", () => {
		const html = words(
			render(
				h(EnableFooter, {
					view: enableView(state({ step: "done" }), { twoFactor: false }),
					busy: false,
					onLeft: () => {},
					onPrimary: () => {},
				}),
			),
		);
		expect(html).toContain(p.methods.done);
		expect(html).not.toContain(p.enable.back);
		expect(html).not.toContain("Cancel");
	});
});

describe("what changes", () => {
	it("lists what changes and what does not", () => {
		const html = words(body({ step: "what" }));
		for (const line of [
			p.enable.what.body,
			p.enable.what.shared,
			p.enable.what.backups,
			p.enable.what.features,
			p.enable.what.unchanged,
			p.enable.what.unchangedTitle,
			"What this changes",
		])
			expect(html).toContain(line);
	});

	it("offers See which only when something can open it", () => {
		expect(body({ step: "what" })).not.toContain(p.enable.what.seeWhich);
		expect(body({ step: "what" }, { onSeeWhich: () => {} })).toContain(
			p.enable.what.seeWhich,
		);
	});
});

describe("new password", () => {
	it("asks twice and lights the rules", () => {
		const html = words(body({ step: "newPassword", password: "Abcdef12" }));
		expect(html).toContain("New password");
		expect(html).toContain("Confirm new password");
		expect(html).toContain("8 or more characters");
		expect(html.split('autoComplete="new-password"').length - 1).toBe(2);
		// All three rules are met, so none is the muted "not yet" row.
		expect(html).not.toContain("text-fg-3");
		expect(body({ step: "newPassword", password: "a" })).toContain("text-fg-3");
	});

	it("says when the two do not match", () => {
		const html = words(
			body({ step: "newPassword", password: "Abcdef12", confirm: "Abcdef1" }),
		);
		expect(html).toContain("The new passwords don't match");
		expect(words(body({ step: "newPassword", password: "a" }))).not.toContain(
			"don't match",
		);
	});

	it("locks the fields while the keys are made", () => {
		const html = body({ step: "newPassword", busy: true });
		expect(html.match(/disabled=""/g)?.length).toBe(2);
	});

	it("shows the failure as an alert", () => {
		const html = words(body({ step: "newPassword", error: "failed" }));
		expect(html).toContain('role="alert"');
		expect(html).toContain(p.errors.failed);
	});
});

describe("ways to get back in", () => {
	it("leads with Create key and gives the other two their reason", () => {
		const html = words(body({ step: "methods", keyText: KEY }));
		expect(html).toContain(p.methods.createKey);
		expect(html).toContain(p.methods.device);
		expect(html).toContain(p.methods.person);
		expect(html.split(p.methods.reason).length - 1).toBe(2);
	});

	it("shows Done in place of Create key once the key is confirmed", () => {
		const html = words(body({ step: "methods", keyText: KEY, keySaved: true }));
		expect(html).not.toContain(p.methods.createKey);
		expect(html).toContain(p.methods.done);
	});
});

describe("save the key", () => {
	it("shows the nine groups with their numbers and the three ways to keep it", () => {
		const html = words(body({ step: "saveKey", keyText: KEY }));
		KEY.split("-").forEach((group, i) => {
			expect(html).toContain(group);
			expect(html).toContain(`Group ${i + 1}`);
		});
		for (const label of [p.recoveryKey.copy, p.recoveryKey.download, p.recoveryKey.print])
			expect(html).toContain(label);
		expect(html).toContain(p.recoveryKey.label);
	});
});

describe("confirm the key", () => {
	it("asks for the two groups by number", () => {
		const html = words(body({ step: "confirmKey", keyText: KEY, groups: [2, 6] }));
		expect(html).toContain("Type group 3 and group 7.");
		expect(html).toContain("Group 3");
		expect(html).toContain("Group 7");
		expect(html).not.toContain(p.recoveryKey.mismatch);
	});

	it("flags the group that is complete and wrong, and only that one", () => {
		const html = words(
			body({
				step: "confirmKey",
				keyText: KEY,
				groups: [2, 6],
				typed: ["E20918", "C5RR35"],
			}),
		);
		expect(html.split(p.recoveryKey.mismatch).length - 1).toBe(1);
		expect(html).toContain('aria-invalid="true"');
	});
});

describe("confirm it's you", () => {
	it("asks for the password, and the code only with two-factor", () => {
		const plain = words(body({ step: "confirmYou" }));
		expect(plain).toContain(p.enable.confirmYou.body);
		expect(plain).not.toContain("6-digit code");
		expect(words(body({ step: "confirmYou" }, { twoFactor: true }))).toContain(
			"6-digit code",
		);
	});

	it("words each try-again failure", () => {
		for (const code of ["wrongPassword", "wrongCode", "tooMany", "failed"] as const) {
			const html = words(body({ step: "confirmYou", error: code }));
			expect(html, code).toContain(p.errors[code]);
			expect(html, code).toContain("<input");
		}
	});

	it("a final failure is the one Notice, with no fields left", () => {
		for (const code of ["checkFailed", "notOffered"] as const) {
			const html = words(body({ step: "confirmYou", error: code }));
			expect(html).toContain(p.errors[code]);
			expect(html).toContain('data-tone="danger"');
			expect(html).not.toContain("<input");
		}
	});
});

describe("the footer", () => {
	const footer = (patch: Partial<EnableState>, busy = false) =>
		words(
			render(
				h(EnableFooter, {
					view: enableView(state(patch), { twoFactor: false }),
					busy,
					onLeft: () => {},
					onPrimary: () => {},
				}) as ReactElement,
			),
		);

	it("is Cancel and Continue on the first step and Back after it", () => {
		expect(footer({ step: "what" })).toContain("Cancel");
		const later = footer({ step: "newPassword" });
		expect(later).toContain(p.enable.back);
		expect(later).not.toContain("Cancel");
	});

	it("disables Continue until the step is ready, and Back while busy", () => {
		const waiting = footer({ step: "methods" });
		expect(waiting).toContain(p.enable.methods.continue);
		expect(waiting.match(/disabled=""/g)?.length).toBe(1);
		expect(footer({ step: "confirmYou", current: "x" }, true)).toMatch(
			/<button[^>]*disabled=""[^>]*>Back<\/button>/,
		);
		expect(footer({ step: "confirmYou", current: "x" })).not.toMatch(
			/<button[^>]*disabled=""[^>]*>Back<\/button>/,
		);
	});

	it("is only Close after a final failure", () => {
		const html = footer({ step: "confirmYou", error: "checkFailed" });
		expect(html).toContain("Close");
		expect(html).not.toContain(p.enable.confirmYou.continue);
	});
});
