// The recovery sheet's rules (src/client/recover-model.ts), shared by the web
// and the phone: the groups, a paste, when Continue is allowed, and where each
// failure sends the person.
import { describe, expect, it } from "vitest";
import {
	cleanGroup,
	keyComplete,
	pasteGroups,
	type RecoverAction,
	type RecoverState,
	recoverFieldsLocked,
	recoverInitialState,
	recoverKeyText,
	recoverReducer,
	recoverView,
} from "../src/client/recover-model";

const KEY = "000G40-R40M30-E20918-5GR38E-1W8124-GK2GAH-C5RR34-D1P70X-3RFH8K";
const GROUPS = KEY.split("-");
const PASSWORD = "Correct-horse-9-battery";
/** The platform says the rules are met; the core only checks the two fields alike. */
const RULES = { rulesMet: true };

const run = (state: RecoverState, ...actions: RecoverAction[]) =>
	actions.reduce(recoverReducer, state);
const full = (patch: Partial<RecoverState> = {}): RecoverState => ({
	...recoverInitialState(),
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
		const empty = recoverInitialState().groups;
		expect(pasteGroups(empty, 4, KEY)).toEqual(GROUPS);
		expect(pasteGroups(empty, 0, KEY.toLowerCase())).toEqual(GROUPS);
		expect(pasteGroups(empty, 7, KEY.replaceAll("-", " "))).toEqual(GROUPS);
		expect(pasteGroups(empty, 2, `${KEY}\n`)).toEqual(GROUPS);
	});

	it("reads O as 0 and I and L as 1, the way the key is read", () => {
		const empty = recoverInitialState().groups;
		expect(pasteGroups(empty, 0, "oIlOil")[0]).toBe("011011");
	});

	it("fills from the group it was pasted into when it is not a whole key, and stops at the ninth", () => {
		const base = recoverInitialState().groups;
		const partial = pasteGroups(base, 6, "AAAAAABBBBBBCCCCCCDDDDDD");
		expect(partial.slice(6)).toEqual(["AAAAAA", "BBBBBB", "CCCCCC"]);
		expect(partial.slice(0, 6)).toEqual(base.slice(0, 6));
		expect(pasteGroups(base, 1, "ABC")[1]).toBe("ABC");
	});

	it("fills nothing for text the key reading refuses", () => {
		const base = recoverInitialState().groups;
		expect(pasteGroups(base, 0, `${KEY}é`)).toEqual(base);
	});
});

describe("recoverReducer", () => {
	it("Continue needs all nine full groups", () => {
		expect(keyComplete(recoverInitialState())).toBe(false);
		expect(keyComplete(full())).toBe(true);
		const eight = full({ groups: [...GROUPS.slice(0, 8), "ABC"] });
		expect(keyComplete(eight)).toBe(false);
		expect(recoverView(eight, RULES).primaryDisabled).toBe(true);
		expect(recoverView(full(), RULES).primaryDisabled).toBe(false);
		expect(recoverKeyText(full())).toBe(KEY);
	});

	it("moves to the new password only when the proof landed", () => {
		const busy = run(full(), { type: "busy" });
		const next = run(busy, { type: "proven" });
		expect(next.step).toBe("password");
		expect(next.busy).toBe(false);
		// A late proof after a reset finds the sheet at the start and changes nothing.
		expect(run(recoverInitialState(), { type: "proven" }).step).toBe("enter");
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
		expect(recoverFieldsLocked(after)).toBe(false);
		expect(recoverView(after, RULES).primaryDisabled).toBe(false);
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
		expect(recoverView(after, RULES).primaryDisabled).toBe(false);
	});

	it("a link that is gone blocks everything until the sheet resets, and offers Close", () => {
		const gone = run(full(), { type: "failed", code: "linkExpired" });
		expect(recoverFieldsLocked(gone)).toBe(true);
		expect(recoverView(gone, RULES).primary).toBeNull();
		expect(recoverView(gone, RULES).left).toBe("close");
		// No keystroke, paste or retry moves it.
		expect(run(gone, { type: "group", index: 0, value: "AAAAAA" })).toBe(gone);
		expect(run(gone, { type: "paste", from: 0, text: KEY })).toBe(gone);
		expect(run(gone, { type: "busy" })).toBe(gone);
		expect(run(gone, { type: "reset" }).error).toBeNull();
	});

	it("an account with no recovery key opens locked on that line, with Cancel and a disabled Continue", () => {
		const state = recoverInitialState("unavailable");
		expect(recoverFieldsLocked(state)).toBe(true);
		const view = recoverView(state, RULES);
		expect(view.left).toBe("cancel");
		expect(view.primaryDisabled).toBe(true);
		// The reset after a close keeps the preset: the link has not changed.
		expect(run(state, { type: "reset", preset: "unavailable" }).error).toBe(
			"unavailable",
		);
		expect(run(state, { type: "reset" }).error).toBeNull();
	});

	it("the new password needs the rules the platform checks and the same confirmation", () => {
		const on = (password: string, confirm: string, rulesMet = true) =>
			recoverView(full({ step: "password", password, confirm }), { rulesMet })
				.primaryDisabled;
		expect(on("", "")).toBe(true);
		expect(on(PASSWORD, "Another-horse-9-battery")).toBe(true);
		expect(on(PASSWORD, PASSWORD)).toBe(false);
		// Alike but weak: the platform's rules say no.
		expect(on("short", "short", false)).toBe(true);
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

	it("after a commit that may have gone through, locks both password fields for good, whatever the retry says", () => {
		const onPassword = full({
			step: "password",
			password: PASSWORD,
			confirm: PASSWORD,
		});
		const unknown = run(
			onPassword,
			{ type: "busy" },
			{ type: "failed", code: "unconfirmed" },
		);
		expect(unknown.unconfirmed).toBe(true);
		expect(recoverFieldsLocked(unknown)).toBe(true);
		// Not final: Set password still works and sends the same request.
		expect(recoverView(unknown, RULES).primaryDisabled).toBe(false);
		expect(run(unknown, { type: "text", field: "password", value: "x" })).toBe(
			unknown,
		);
		expect(run(unknown, { type: "text", field: "confirm", value: "x" })).toBe(
			unknown,
		);
		// A retry that is refused (a rate limit) does not unlock them: the core
		// still holds the request that may have committed.
		const refused = run(
			unknown,
			{ type: "busy" },
			{ type: "failed", code: "tooMany" },
		);
		expect(refused.unconfirmed).toBe(true);
		expect(recoverFieldsLocked(refused)).toBe(true);
		expect(refused.password).toBe(PASSWORD);
	});

	it("a refusal before any commit leaves the password fields editable, so the retry carries what is typed", () => {
		const onPassword = full({
			step: "password",
			password: PASSWORD,
			confirm: PASSWORD,
		});
		const refused = run(
			onPassword,
			{ type: "busy" },
			{ type: "failed", code: "tooMany" },
		);
		expect(refused.unconfirmed).toBe(false);
		expect(recoverFieldsLocked(refused)).toBe(false);
		expect(
			run(refused, { type: "text", field: "password", value: "Other-Pw-2027?" })
				.password,
		).toBe("Other-Pw-2027?");
	});

	it("starting over at the key clears the lock", () => {
		const onPassword = full({
			step: "password",
			password: PASSWORD,
			confirm: PASSWORD,
			unconfirmed: true,
		});
		expect(
			run(onPassword, { type: "failed", code: "keysChanged" }).unconfirmed,
		).toBe(false);
		expect(run(onPassword, { type: "reset" }).unconfirmed).toBe(false);
	});
});
