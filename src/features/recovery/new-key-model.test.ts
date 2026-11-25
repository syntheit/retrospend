// The Make new key sheet's rules (new-key-model.ts): the steps, Back, which
// failures end the sheet and which send it back to the password.
import { describe, expect, it } from "vitest";
import {
	fieldsLocked,
	INITIAL_STATE,
	type NewKeyAction,
	type NewKeyState,
	newKeyReducer,
	newKeyView,
} from "./new-key-model";

const KEY = "000G40-R40M30-E20918-5GR38E-1W8124-GK2GAH-C5RR34-D1P70X-3RFH8K";
const GROUPS = KEY.split("-");
const run = (state: NewKeyState, ...actions: NewKeyAction[]) =>
	actions.reduce(newKeyReducer, state);

const keyShown = (): NewKeyState =>
	run(
		{ ...INITIAL_STATE, current: "my password" },
		{ type: "busy" },
		{ type: "keyMade", keyText: KEY },
	);
const confirming = (): NewKeyState =>
	run(keyShown(), { type: "savedIt", groups: [2, 6] });

describe("newKeyReducer", () => {
	it("needs the password to continue, and drops it once the key is made", () => {
		expect(newKeyView(INITIAL_STATE).primaryDisabled).toBe(true);
		const typed = run(INITIAL_STATE, { type: "password", value: "pw" });
		expect(newKeyView(typed).primaryDisabled).toBe(false);
		const shown = keyShown();
		expect(shown.step).toBe("saveKey");
		expect(shown.keyText).toBe(KEY);
		expect(shown.current).toBe("");
	});

	it("only a run that began at the password step lands its key", () => {
		expect(run(INITIAL_STATE, { type: "keyMade", keyText: KEY }).step).toBe(
			"password",
		);
		expect(run(keyShown(), { type: "keyMade", keyText: "other" }).keyText).toBe(
			KEY,
		);
	});

	it("saving needs both asked groups typed back, read the way the key is read", () => {
		const base = confirming();
		expect(base.step).toBe("confirmKey");
		expect(newKeyView(base).primaryDisabled).toBe(true);
		// Group 3 has a zero in it: typed as an o, in lower case, it still matches.
		const one = run(base, {
			type: "group",
			index: 0,
			value: (GROUPS[2] ?? "").toLowerCase().replaceAll("0", "o"),
		});
		expect(GROUPS[2]).toContain("0");
		expect(newKeyView(one).primaryDisabled).toBe(true);
		const wrong = run(one, { type: "group", index: 1, value: "ZZZZZZ" });
		expect(newKeyView(wrong).primaryDisabled).toBe(true);
		const right = run(one, {
			type: "group",
			index: 1,
			value: (GROUPS[6] ?? "").toLowerCase(),
		});
		expect(newKeyView(right).primaryDisabled).toBe(false);
		expect(newKeyView(right).primary).toBe("protection.newKey.save");
	});

	it("Back from the key drops it, Back from the confirm keeps the groups so the next pair differs", () => {
		const back = run(keyShown(), { type: "back" });
		expect(back).toEqual(INITIAL_STATE);
		const confirm = run(confirming(), { type: "back" });
		expect(confirm.step).toBe("saveKey");
		expect(confirm.keyText).toBe(KEY);
		expect(confirm.groups).toEqual([2, 6]);
		expect(confirm.typed).toEqual(["", ""]);
	});

	it("a wrong password is a line on the password step and nothing is final", () => {
		const after = run(
			{ ...INITIAL_STATE, current: "pw" },
			{ type: "busy" },
			{ type: "failed", code: "wrongPassword" },
		);
		expect(after.error).toBe("wrongPassword");
		expect(after.busy).toBe(false);
		expect(fieldsLocked(after)).toBe(false);
		expect(newKeyView(after).primaryDisabled).toBe(false);
	});

	it("keys that changed under the run start the sheet over, without the key that was made", () => {
		const after = run(
			confirming(),
			{ type: "busy" },
			{ type: "failed", code: "keysChanged" },
		);
		expect(after.step).toBe("password");
		expect(after.keyText).toBe("");
		expect(after.groups).toBeNull();
		expect(after.error).toBe("keysChanged");
	});

	it("a key that was sent and is not there is final: Close only, and nothing moves", () => {
		const gone = run(
			confirming(),
			{ type: "busy" },
			{ type: "failed", code: "notSaved" },
		);
		const view = newKeyView(gone);
		expect(view.primary).toBeNull();
		expect(view.left).toBe("close");
		expect(fieldsLocked(gone)).toBe(true);
		expect(run(gone, { type: "back" })).toBe(gone);
		expect(run(gone, { type: "group", index: 0, value: "X" })).toBe(gone);
		expect(run(gone, { type: "reset" })).toEqual(INITIAL_STATE);
	});

	it("a failure that can be tried again keeps the key and the typed groups", () => {
		const typed = run(
			confirming(),
			{ type: "group", index: 0, value: GROUPS[2] ?? "" },
			{ type: "group", index: 1, value: GROUPS[6] ?? "" },
			{ type: "busy" },
			{ type: "failed", code: "failed" },
		);
		expect(typed.step).toBe("confirmKey");
		expect(typed.keyText).toBe(KEY);
		expect(newKeyView(typed).primaryDisabled).toBe(false);
	});

	it("ignores typing while it works", () => {
		const busy = run(confirming(), { type: "busy" });
		expect(run(busy, { type: "group", index: 0, value: "A" })).toBe(busy);
		expect(run(busy, { type: "back" })).toBe(busy);
	});
});
