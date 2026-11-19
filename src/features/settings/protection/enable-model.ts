// The enable sheet's states and rules, with no React and no network: which
// step shows, what it asks for, when Continue is allowed, what Back does and
// what each failure means. The sheet (enable-sheet.tsx) only draws this and
// calls the callbacks it is given (make the keys, save them), so every view
// state can be tested here and in the server-rendered steps.
//
// The order is the mockup's (protection.html E1 to E3, R1, R2): what changes,
// a new password, the ways to get back in with the recovery key made, shown
// and confirmed, then Confirm it's you, then done.
import {
	passwordMeetsRules,
	TWO_FACTOR_CODE_LENGTH,
} from "@retrospend/api-contract";
import {
	type ConfirmGroups,
	type FailureCode,
	groupMatches,
	isFinalFailure,
	recoveryKeyGroups,
} from "@retrospend/crypto/client";

export const ENABLE_STEPS = [
	"what",
	"newPassword",
	"methods",
	"saveKey",
	"confirmKey",
	"confirmYou",
	"done",
] as const;
export type EnableStep = (typeof ENABLE_STEPS)[number];

export type EnableState = {
	step: EnableStep;
	/** The new password and its confirmation. Gone as soon as the keys exist. */
	password: string;
	confirm: string;
	/** The recovery key as written down; empty until the keys are made. */
	keyText: string;
	/** The two groups asked for at the confirm step, counted from 0. */
	groups: ConfirmGroups | null;
	typed: readonly [string, string];
	/** The recovery key was typed back correctly. */
	keySaved: boolean;
	/** Confirm it's you: the current password and the two-factor code. */
	current: string;
	code: string;
	busy: boolean;
	error: FailureCode | null;
};

export const INITIAL_STATE: EnableState = {
	step: "what",
	password: "",
	confirm: "",
	keyText: "",
	groups: null,
	typed: ["", ""],
	keySaved: false,
	current: "",
	code: "",
	busy: false,
	error: null,
};

export type TextField = "password" | "confirm" | "current" | "code";

export type EnableAction =
	| { type: "text"; field: TextField; value: string }
	| { type: "group"; index: 0 | 1; value: string }
	| { type: "forward" }
	| { type: "back" }
	| { type: "busy" }
	| { type: "failed"; code: FailureCode }
	| { type: "keysMade"; keyText: string }
	| { type: "createKey" }
	| { type: "savedIt"; groups: ConfirmGroups }
	| { type: "keyConfirmed" }
	| { type: "saved" }
	| { type: "reset" };

/** Both typed groups are the groups asked for. Nothing asked yet is never a match. */
export function groupsConfirmed(state: EnableState): boolean {
	if (!state.groups || state.keyText === "") return false;
	const all = recoveryKeyGroups(state.keyText);
	return state.groups.every((at, i) =>
		groupMatches(state.typed[i] ?? "", all[at] ?? ""),
	);
}

/** The new password meets the rules and the confirmation is the same. */
export function newPasswordReady(
	state: Pick<EnableState, "password" | "confirm">,
): boolean {
	return passwordMeetsRules(state.password) && state.password === state.confirm;
}

/** Nothing can be typed, tried or changed: it is working, or it failed for good. */
export function fieldsLocked(state: EnableState): boolean {
	return state.busy || isFinalFailure(state.error);
}

export function enableReducer(
	state: EnableState,
	action: EnableAction,
): EnableState {
	// A final failure stays until the sheet closes (reset): no keystroke, step
	// or retry moves past it.
	if (isFinalFailure(state.error) && action.type !== "reset") return state;
	switch (action.type) {
		case "reset":
			return INITIAL_STATE;
		case "text":
			return state.busy
				? state
				: { ...state, [action.field]: action.value, error: null };
		case "group": {
			if (state.busy || state.step !== "confirmKey") return state;
			const typed: [string, string] = [state.typed[0], state.typed[1]];
			typed[action.index] = action.value;
			return { ...state, typed };
		}
		case "busy":
			return state.busy ? state : { ...state, busy: true, error: null };
		case "failed":
			return { ...state, busy: false, error: action.code };
		case "forward":
			if (state.busy) return state;
			if (state.step === "what") return { ...state, step: "newPassword" };
			if (state.step === "methods" && state.keySaved)
				return { ...state, step: "confirmYou", error: null };
			return state;
		case "keysMade":
			// Only the run that began at the password step may land: a late answer
			// after a reset finds the state already back at the start.
			if (state.step !== "newPassword" || !state.busy) return state;
			return {
				...INITIAL_STATE,
				step: "methods",
				keyText: action.keyText,
			};
		case "createKey":
			return state.step === "methods" && !state.busy
				? { ...state, step: "saveKey" }
				: state;
		case "savedIt":
			return state.step === "saveKey" && !state.busy
				? {
						...state,
						step: "confirmKey",
						groups: action.groups,
						typed: ["", ""],
					}
				: state;
		case "keyConfirmed":
			// The guard lives here, not in the button: a confirmed key is one whose
			// two groups were typed back.
			return state.step === "confirmKey" && groupsConfirmed(state)
				? { ...state, step: "methods", keySaved: true, typed: ["", ""] }
				: state;
		case "saved":
			return state.step === "confirmYou"
				? {
						...state,
						step: "done",
						current: "",
						code: "",
						busy: false,
						error: null,
					}
				: state;
		case "back":
			return goBack(state);
	}
}

function goBack(state: EnableState): EnableState {
	if (state.busy) return state;
	switch (state.step) {
		case "newPassword":
			return { ...state, step: "what", error: null };
		case "methods":
			// The keys were made for the password that is gone, so they go with it.
			return { ...INITIAL_STATE, step: "newPassword" };
		case "saveKey":
			return { ...state, step: "methods" };
		case "confirmKey":
			// The groups stay so the next pair is never this one (pickConfirmGroups).
			return { ...state, step: "saveKey", typed: ["", ""] };
		case "confirmYou":
			return { ...state, step: "methods", current: "", code: "", error: null };
		default:
			return state;
	}
}

export type LeftButton = "cancel" | "back" | "close";

export type EnableView = {
	/** A key of the message catalog, from the root. */
	title: string;
	left: LeftButton | null;
	/** The key of the Continue button's words; null when there is no Continue. */
	primary: string | null;
	primaryDisabled: boolean;
};

const TITLE: Record<EnableStep, string> = {
	what: "protection.enable.what.title",
	newPassword: "protection.enable.newPassword.title",
	methods: "protection.enable.methods.title",
	saveKey: "protection.recoveryKey.saveTitle",
	confirmKey: "protection.recoveryKey.confirmTitle",
	confirmYou: "protection.enable.confirmYou.title",
	done: "protection.toast.keysSaved",
};

const PRIMARY: Record<EnableStep, string> = {
	what: "protection.enable.what.continue",
	newPassword: "protection.enable.newPassword.continue",
	methods: "protection.enable.methods.continue",
	saveKey: "protection.recoveryKey.saved",
	confirmKey: "protection.enable.methods.continue",
	confirmYou: "protection.enable.confirmYou.continue",
	done: "protection.methods.done",
};

export function enableView(
	state: EnableState,
	options: { twoFactor: boolean },
): EnableView {
	const title = TITLE[state.step];
	if (state.step === "done")
		return { title, left: null, primary: PRIMARY.done, primaryDisabled: false };
	if (isFinalFailure(state.error))
		return { title, left: "close", primary: null, primaryDisabled: true };
	return {
		title,
		left: state.step === "what" ? "cancel" : "back",
		primary: PRIMARY[state.step],
		primaryDisabled: !stepReady(state, options),
	};
}

function stepReady(state: EnableState, options: { twoFactor: boolean }) {
	switch (state.step) {
		case "newPassword":
			return newPasswordReady(state);
		case "methods":
			return state.keySaved;
		case "confirmKey":
			return groupsConfirmed(state);
		case "confirmYou":
			return (
				state.current !== "" &&
				(!options.twoFactor || state.code.length === TWO_FACTOR_CODE_LENGTH)
			);
		default:
			return true;
	}
}

/**
 * A typed group that is as long as the group and still not it. Shorter text is
 * still being typed, so it is not called wrong yet.
 */
export function groupMismatch(state: EnableState, index: 0 | 1): boolean {
	const at = state.groups?.[index];
	if (at === undefined || state.keyText === "") return false;
	const group = recoveryKeyGroups(state.keyText)[at] ?? "";
	const typed = state.typed[index];
	return (
		typed.replace(/[\s-]/g, "").length >= group.length &&
		!groupMatches(typed, group)
	);
}
