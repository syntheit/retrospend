// The recovery sheet's rules (recover-model.ts): the groups, a paste, when
// Continue is allowed, and where each failure sends the person.
import { describe, expect, it } from "vitest";
import {
	cleanGroup,
	fieldsLocked,
	initialState,
	keyComplete,
	keyText,
	pasteGroups,
	type RecoverAction,
	type RecoverState,
	recoverReducer,
	recoverView,
} from "./recover-model";

const KEY = "000G40-R40M30-E20918-5GR38E-1W8124-GK2GAH-C5RR34-D1P70X-3RFH8K";
const GROUPS = KEY.split("-");
const PASSWORD = "Correct-horse-9-battery";

const run = (state: RecoverState, ...actions: RecoverAction[]) =>
	actions.reduce(recoverReducer, state);
const full = (patch: Partial<RecoverState> = {}): RecoverState => ({
	...initialState(),
	groups: GROUPS,
	...patch,
});

describe("cleanGroup", () => {
	it("keeps letters and digits, upper case, at most six", () => {
		expect(cleanGroup("ab-c d!efgh")).toBe("ABCDEF");
		expect(cleanGroup("")).toBe("");
	});
});

describe("pasteGroups", () => {
	it("fills all nine groups from a whole key, whatever the separators and case", () => {
		const empty = initialState().groups;
		expect(pasteGroups(empty, 4, KEY)).toEqual(GROUPS);
		expect(pasteGroups(empty, 0, KEY.toLowerCase())).toEqual(GROUPS);
		expect(pasteGroups(empty, 7, KEY.replaceAll("-", " "))).toEqual(GROUPS);
		expect(pasteGroups(empty, 2, `${KEY}\n`)).toEqual(GROUPS);
	});

	it("reads O as 0 and I and L as 1, the way the key is read", () => {
		const empty = initialState().groups;
		expect(pasteGroups(empty, 0, "oIlOil")[0]).toBe("011011");
	});

	it("fills from the group it was pasted into when it is not a whole key, and stops at the ninth", () => {
		const base = initialState().groups;
		const partial = pasteGroups(base, 6, "AAAAAABBBBBBCCCCCCDDDDDD");
		expect(partial.slice(6)).toEqual(["AAAAAA", "BBBBBB", "CCCCCC"]);
		expect(partial.slice(0, 6)).toEqual(base.slice(0, 6));
		expect(pasteGroups(base, 1, "ABC")[1]).toBe("ABC");
	});

	it("fills nothing for text the key reading refuses", () => {
		const base = initialState().groups;
		expect(pasteGroups(base, 0, `${KEY}é`)).toEqual(base);
	});
});

describe("recoverReducer", () => {
	it("Continue needs all nine full groups", () => {
		expect(keyComplete(initialState())).toBe(false);
		expect(keyComplete(full())).toBe(true);
		const eight = full({ groups: [...GROUPS.slice(0, 8), "ABC"] });
		expect(keyComplete(eight)).toBe(false);
		expect(recoverView(eight).primaryDisabled).toBe(true);
		expect(recoverView(full()).primaryDisabled).toBe(false);
		expect(keyText(full())).toBe(KEY);
	});

	it("moves to the new password only when the proof landed", () => {
		const busy = run(full(), { type: "busy" });
		const next = run(busy, { type: "proven" });
		expect(next.step).toBe("password");
		expect(next.busy).toBe(false);
		// A late proof after a reset finds the sheet at the start and changes nothing.
		expect(run(initialState(), { type: "proven" }).step).toBe("enter");
	});

	it("keeps what was typed when the key is wrong, and shows the line", () => {
		const after = run(
			full(),
			{ type: "busy" },
			{ type: "failed", code: "wrongKey" },
		);
		expect(after.step).toBe("enter");
		expect(after.groups).toEqual(GROUPS);
		expect(after.error).toBe("wrongKey");
		expect(after.busy).toBe(false);
		// Retyping a group clears the line.
		expect(
			run(after, { type: "group", index: 0, value: "ZZZZZZ" }).error,
		).toBeNull();
	});

	it("a typo is a line under the groups, not a blocked screen", () => {
		const after = run(full(), { type: "failed", code: "typo" });
		expect(fieldsLocked(after)).toBe(false);
		expect(recoverView(after).primaryDisabled).toBe(false);
	});

	it("returns to the key, with the password gone, when the keys changed or the proof no longer stands", () => {
		for (const code of ["keysChanged", "wrongKey"] as const) {
			const onPassword = full({
				step: "password",
				password: PASSWORD,
				confirm: PASSWORD,
				busy: true,
			});
			const after = run(onPassword, { type: "failed", code });
			expect(after.step).toBe("enter");
			expect(after.password).toBe("");
			expect(after.confirm).toBe("");
			expect(after.error).toBe(code);
		}
	});

	it("stays on the password step for a failure that can be tried again, keeping the password", () => {
		const onPassword = full({
			step: "password",
			password: PASSWORD,
			confirm: PASSWORD,
			busy: true,
		});
		const after = run(onPassword, { type: "failed", code: "failed" });
		expect(after.step).toBe("password");
		expect(after.password).toBe(PASSWORD);
		expect(recoverView(after).primaryDisabled).toBe(false);
	});

	it("a link that is gone blocks everything until the sheet resets, and offers Close", () => {
		const gone = run(full(), { type: "failed", code: "linkExpired" });
		expect(fieldsLocked(gone)).toBe(true);
		expect(recoverView(gone).primary).toBeNull();
		expect(recoverView(gone).left).toBe("close");
		// No keystroke, paste or retry moves it.
		expect(run(gone, { type: "group", index: 0, value: "AAAAAA" })).toBe(gone);
		expect(run(gone, { type: "paste", from: 0, text: KEY })).toBe(gone);
		expect(run(gone, { type: "busy" })).toBe(gone);
		expect(run(gone, { type: "reset" }).error).toBeNull();
	});

	it("an account with no recovery key opens locked on that line, with Cancel and a disabled Continue", () => {
		const state = initialState("unavailable");
		expect(fieldsLocked(state)).toBe(true);
		const view = recoverView(state);
		expect(view.left).toBe("cancel");
		expect(view.primaryDisabled).toBe(true);
		// The reset after a close keeps the preset: the link has not changed.
		expect(run(state, { type: "reset", preset: "unavailable" }).error).toBe(
			"unavailable",
		);
		expect(run(state, { type: "reset" }).error).toBeNull();
	});

	it("the new password needs the rules and the same confirmation", () => {
		const on = (password: string, confirm: string) =>
			recoverView(full({ step: "password", password, confirm }))
				.primaryDisabled;
		expect(on("", "")).toBe(true);
		expect(on("short", "short")).toBe(true);
		expect(on(PASSWORD, "Another-horse-9-battery")).toBe(true);
		expect(on(PASSWORD, PASSWORD)).toBe(false);
	});

	it("ignores typing while it works, and groups on the password step", () => {
		const busy = run(full(), { type: "busy" });
		expect(run(busy, { type: "group", index: 0, value: "AAAAAA" })).toBe(busy);
		const onPassword = full({ step: "password" });
		expect(run(onPassword, { type: "group", index: 0, value: "AAAAAA" })).toBe(
			onPassword,
		);
		expect(
			run(full(), { type: "text", field: "password", value: "x" }),
		).toEqual(full());
	});
});
