import { TWO_FACTOR_CODE_LENGTH } from "@retrospend/api-contract";
import { groupsConfirmed } from "@retrospend/crypto/client";
import { describe, expect, it } from "vitest";
import {
	type EnableAction,
	type EnableState,
	enableReducer,
	enableView,
	fieldsLocked,
	groupMismatch,
	INITIAL_STATE,
	newPasswordReady,
} from "./enable-model";

// "ascending" from the shared recovery key vectors: nine different groups.
const KEY = "000G40-R40M30-E20918-5GR38E-1W8124-GK2GAH-C5RR34-D1P70X-3RFH8K";

const run = (actions: EnableAction[], from: EnableState = INITIAL_STATE) =>
	actions.reduce(enableReducer, from);
const at = (patch: Partial<EnableState>): EnableState => ({
	...INITIAL_STATE,
	...patch,
});
const OPTIONS = { twoFactor: false };

/** On the confirm step with groups 3 and 7 asked for (indexes 2 and 6). */
const confirming = (typed: [string, string] = ["", ""]) =>
	at({ step: "confirmKey", keyText: KEY, groups: [2, 6], typed });

describe("the order of the steps", () => {
	it("walks what, password, methods, key, confirm, methods, confirm you, done", () => {
		let s = run([{ type: "forward" }]);
		expect(s.step).toBe("newPassword");
		s = run(
			[
				{ type: "text", field: "password", value: "Abcdef12" },
				{ type: "busy" },
				{ type: "keysMade", keyText: KEY },
			],
			s,
		);
		expect(s.step).toBe("methods");
		s = run([{ type: "createKey" }], s);
		expect(s.step).toBe("saveKey");
		s = run([{ type: "savedIt", groups: [2, 6] }], s);
		expect(s.step).toBe("confirmKey");
		s = run(
			[
				{ type: "group", index: 0, value: "E20918" },
				{ type: "group", index: 1, value: "c5rr34" },
				{ type: "keyConfirmed" },
			],
			s,
		);
		expect(s.step).toBe("methods");
		expect(s.keySaved).toBe(true);
		s = run([{ type: "forward" }], s);
		expect(s.step).toBe("confirmYou");
		s = run([{ type: "busy" }, { type: "saved" }], s);
		expect(s.step).toBe("done");
	});

	it("does not leave the methods step until the key is confirmed", () => {
		const s = at({ step: "methods", keyText: KEY });
		expect(run([{ type: "forward" }], s).step).toBe("methods");
	});
});

describe("the new password step", () => {
	it("needs every rule met and the same text twice", () => {
		expect(newPasswordReady({ password: "abc", confirm: "abc" })).toBe(false);
		expect(newPasswordReady({ password: "Abcdef12", confirm: "Abcdef1" })).toBe(
			false,
		);
		expect(
			newPasswordReady({ password: "Abcdef12", confirm: "Abcdef12" }),
		).toBe(true);
		const s = at({
			step: "newPassword",
			password: "Abcdef12",
			confirm: "Abcdef12",
		});
		expect(enableView(s, OPTIONS).primaryDisabled).toBe(false);
		expect(
			enableView(at({ step: "newPassword", password: "Abcdef12" }), OPTIONS)
				.primaryDisabled,
		).toBe(true);
	});

	it("drops the password the moment the keys exist", () => {
		const s = run(
			[
				{ type: "text", field: "password", value: "Abcdef12" },
				{ type: "text", field: "confirm", value: "Abcdef12" },
				{ type: "forward" },
			],
			at({ step: "newPassword" }),
		);
		const made = run([{ type: "busy" }, { type: "keysMade", keyText: KEY }], {
			...s,
			step: "newPassword",
		});
		expect(made.password).toBe("");
		expect(made.confirm).toBe("");
		expect(made.keyText).toBe(KEY);
	});

	it("ignores keys that arrive after the sheet was reset", () => {
		const late = run([{ type: "reset" }, { type: "keysMade", keyText: KEY }]);
		expect(late).toEqual(INITIAL_STATE);
		expect(late.keyText).toBe("");
	});

	it("shows a failure, lets the person try again, and clears it on typing", () => {
		let s = run(
			[
				{ type: "text", field: "password", value: "Abcdef12" },
				{ type: "busy" },
				{ type: "failed", code: "failed" },
			],
			at({ step: "newPassword" }),
		);
		expect(s.busy).toBe(false);
		expect(s.error).toBe("failed");
		s = run([{ type: "text", field: "confirm", value: "A" }], s);
		expect(s.error).toBeNull();
	});

	it("ignores typing and Back while the keys are being made", () => {
		const s = run(
			[{ type: "busy" }],
			at({ step: "newPassword", password: "x" }),
		);
		expect(s.busy).toBe(true);
		expect(
			run([{ type: "text", field: "password", value: "y" }], s).password,
		).toBe("x");
		expect(run([{ type: "back" }], s).step).toBe("newPassword");
	});
});

describe("the recovery key steps", () => {
	it("confirms only when both asked groups are typed", () => {
		expect(groupsConfirmed(confirming(["E20918", ""]))).toBe(false);
		expect(groupsConfirmed(confirming(["E20918", "C5RR34"]))).toBe(true);
		// The groups swapped, or other groups of the same key, are not the ones asked.
		expect(groupsConfirmed(confirming(["C5RR34", "E20918"]))).toBe(false);
		expect(groupsConfirmed(confirming(["000G40", "R40M30"]))).toBe(false);
	});

	it("reads a typed group the way the key is read", () => {
		// Lower case, a space, O for 0 and L for 1.
		expect(groupsConfirmed(confirming(["e2o9 l8", "c5rr34"]))).toBe(true);
	});

	it("never counts nothing asked as confirmed", () => {
		expect(groupsConfirmed(at({ step: "confirmKey", keyText: KEY }))).toBe(
			false,
		);
		expect(groupsConfirmed(at({ step: "confirmKey", groups: [0, 1] }))).toBe(
			false,
		);
	});

	it("keyConfirmed does nothing without both groups typed", () => {
		const s = confirming(["E20918", "C5RR3"]);
		expect(run([{ type: "keyConfirmed" }], s)).toEqual(s);
		expect(enableView(s, OPTIONS).primaryDisabled).toBe(true);
	});

	it("calls a full length wrong group wrong, and a short one not yet", () => {
		expect(groupMismatch(confirming(["E2091", ""]), 0)).toBe(false);
		expect(groupMismatch(confirming(["E20919", ""]), 0)).toBe(true);
		expect(groupMismatch(confirming(["E20918", "C5RR35"]), 0)).toBe(false);
		expect(groupMismatch(confirming(["E20918", "C5RR35"]), 1)).toBe(true);
		expect(groupMismatch(confirming(), 0)).toBe(false);
	});

	it("keeps the asked pair on Back so the next pair can differ, and clears what was typed", () => {
		const s = run([{ type: "back" }], confirming(["E2", "C5"]));
		expect(s.step).toBe("saveKey");
		expect(s.groups).toEqual([2, 6]);
		expect(s.typed).toEqual(["", ""]);
		const again = run([{ type: "savedIt", groups: [1, 4] }], s);
		expect(again.groups).toEqual([1, 4]);
	});

	it("Back from the key steps to the methods keeps the key", () => {
		const s = run([{ type: "back" }], at({ step: "saveKey", keyText: KEY }));
		expect(s.step).toBe("methods");
		expect(s.keyText).toBe(KEY);
	});

	it("Back to the password drops the keys made for it", () => {
		const s = run(
			[{ type: "back" }],
			at({ step: "methods", keyText: KEY, keySaved: true }),
		);
		expect(s.step).toBe("newPassword");
		expect(s.keyText).toBe("");
		expect(s.keySaved).toBe(false);
	});

	it("only Create key starts the key steps", () => {
		expect(run([{ type: "createKey" }], at({ step: "what" })).step).toBe(
			"what",
		);
		expect(
			run([{ type: "savedIt", groups: [0, 1] }], at({ step: "methods" })).step,
		).toBe("methods");
	});
});

describe("confirm it's you", () => {
	const ready = at({ step: "confirmYou", keyText: KEY, keySaved: true });

	it("needs the password, and the code when two-factor is on", () => {
		expect(enableView(ready, OPTIONS).primaryDisabled).toBe(true);
		const typed = { ...ready, current: "pw" };
		expect(enableView(typed, OPTIONS).primaryDisabled).toBe(false);
		expect(enableView(typed, { twoFactor: true }).primaryDisabled).toBe(true);
		expect(
			enableView(
				{ ...typed, code: "1".repeat(TWO_FACTOR_CODE_LENGTH - 1) },
				{ twoFactor: true },
			).primaryDisabled,
		).toBe(true);
		expect(
			enableView(
				{ ...typed, code: "1".repeat(TWO_FACTOR_CODE_LENGTH) },
				{ twoFactor: true },
			).primaryDisabled,
		).toBe(false);
	});

	it("a wrong password is a try-again error that clears when typing", () => {
		let s = run(
			[
				{ type: "text", field: "current", value: "no" },
				{ type: "busy" },
				{ type: "failed", code: "wrongPassword" },
			],
			ready,
		);
		expect(s.step).toBe("confirmYou");
		expect(s.error).toBe("wrongPassword");
		expect(enableView(s, OPTIONS).primary).not.toBeNull();
		s = run([{ type: "text", field: "current", value: "yes" }], s);
		expect(s.error).toBeNull();
	});

	it("a failed read-back is final: no Continue, only Close", () => {
		const s = run(
			[
				{ type: "text", field: "current", value: "pw" },
				{ type: "busy" },
				{ type: "failed", code: "checkFailed" },
			],
			ready,
		);
		const view = enableView(s, OPTIONS);
		expect(view.primary).toBeNull();
		expect(view.left).toBe("close");
	});

	it("clears the password and code once saved", () => {
		const s = run(
			[
				{ type: "text", field: "current", value: "pw" },
				{ type: "text", field: "code", value: "123456" },
				{ type: "busy" },
				{ type: "saved" },
			],
			ready,
		);
		expect(s.step).toBe("done");
		expect(s.current).toBe("");
		expect(s.code).toBe("");
	});

	it("Back to the methods clears the password and code", () => {
		const s = run([{ type: "back" }], { ...ready, current: "pw", code: "1" });
		expect(s.step).toBe("methods");
		expect(s.current).toBe("");
	});
});

describe("a final failure", () => {
	const ready = at({
		step: "confirmYou",
		keyText: KEY,
		keySaved: true,
		current: "pw",
	});
	const over = (code: "checkFailed" | "notOffered") =>
		run([{ type: "busy" }, { type: "failed", code }], ready);

	it("stays through typing, steps and retries until the sheet is closed", () => {
		for (const code of ["checkFailed", "notOffered"] as const) {
			const s = over(code);
			expect(s.error).toBe(code);
			for (const action of [
				{ type: "text", field: "current", value: "other" },
				{ type: "text", field: "code", value: "123456" },
				{ type: "group", index: 0, value: "x" },
				{ type: "forward" },
				{ type: "back" },
				{ type: "busy" },
				{ type: "createKey" },
				{ type: "keyConfirmed" },
				{ type: "saved" },
			] as EnableAction[])
				expect(enableReducer(s, action), `${code} ${action.type}`).toEqual(s);
			expect(enableReducer(s, { type: "reset" })).toEqual(INITIAL_STATE);
		}
	});

	it("locks the fields, as does working, and a try-again failure does not", () => {
		expect(fieldsLocked(over("checkFailed"))).toBe(true);
		expect(fieldsLocked(at({ busy: true }))).toBe(true);
		expect(fieldsLocked(at({ error: "wrongPassword" }))).toBe(false);
		expect(fieldsLocked(INITIAL_STATE)).toBe(false);
	});

	it("also holds on the password step when the keys could not be made", () => {
		const s = run(
			[{ type: "busy" }, { type: "failed", code: "notOffered" }],
			at({ step: "newPassword", password: "Abcdef12", confirm: "Abcdef12" }),
		);
		expect(
			enableReducer(s, { type: "text", field: "password", value: "x" }),
		).toEqual(s);
	});
});

describe("the view of each step", () => {
	it("titles and verbs follow the copy", () => {
		const view = (patch: Partial<EnableState>) =>
			enableView(at(patch), OPTIONS);
		expect(view({ step: "what" })).toMatchObject({
			title: "protection.enable.what.title",
			left: "cancel",
			primary: "protection.enable.what.continue",
			primaryDisabled: false,
		});
		expect(view({ step: "saveKey" })).toMatchObject({
			title: "protection.recoveryKey.saveTitle",
			left: "back",
			primary: "protection.recoveryKey.saved",
			primaryDisabled: false,
		});
		expect(view({ step: "confirmYou", current: "x" })).toMatchObject({
			primary: "protection.enable.confirmYou.continue",
		});
	});

	it("methods wait on the confirmed key", () => {
		expect(enableView(at({ step: "methods" }), OPTIONS).primaryDisabled).toBe(
			true,
		);
		expect(
			enableView(at({ step: "methods", keySaved: true }), OPTIONS)
				.primaryDisabled,
		).toBe(false);
	});

	it("the last step has no way back, only Done", () => {
		const view = enableView(at({ step: "done" }), OPTIONS);
		expect(view.left).toBeNull();
		expect(view.primary).toBe("protection.methods.done");
	});

	it("Back is refused while busy", () => {
		const s = at({ step: "confirmYou", busy: true });
		expect(run([{ type: "back" }], s).step).toBe("confirmYou");
	});
});
