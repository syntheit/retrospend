// The recovery sheet's states and rules, with no React and no network, for the
// web and the phone: the nine groups of the key (typed or pasted), when
// Continue is allowed, what each failure sends the person back to. Each
// platform's sheet only draws this and calls the callbacks it is given. The
// order is the mockup's (R3, R4): the recovery key, proven by the server
// before anything else, then a new password. The new password's rules are
// api-contract's, so the platform tells the view whether they are met.
import { normalizeRecoveryText } from "../keys";
import {
	blocksRecoveryScreen,
	type RecoveryFailureCode,
} from "./recovery-failure";

export const GROUP_COUNT = 9;
export const GROUP_LENGTH = 6;

export type RecoverStep = "enter" | "password";

export type RecoverState = {
	step: RecoverStep;
	/** The nine groups as typed, upper case; empty strings until typed. */
	groups: readonly string[];
	/** The new password and its confirmation. Gone as soon as the sheet resets. */
	password: string;
	confirm: string;
	busy: boolean;
	error: RecoveryFailureCode | null;
	/**
	 * A commit was sent and its outcome is not known. A retry sends that very
	 * request (the core keeps it), so the password stays as it was typed: both
	 * fields are locked until the sheet starts over.
	 */
	unconfirmed: boolean;
};

/** `preset` is a failure known before anything is typed (the link check said the account has no recovery key). */
export const recoverInitialState = (
	preset: RecoveryFailureCode | null = null,
): RecoverState => ({
	step: "enter",
	groups: Array.from({ length: GROUP_COUNT }, () => ""),
	password: "",
	confirm: "",
	busy: false,
	error: preset,
	unconfirmed: false,
});

export type RecoverAction =
	| { type: "group"; index: number; value: string }
	| { type: "paste"; from: number; text: string }
	| { type: "text"; field: "password" | "confirm"; value: string }
	| { type: "busy" }
	| { type: "failed"; code: RecoveryFailureCode }
	| { type: "proven" }
	| { type: "reset"; preset?: RecoveryFailureCode | null };

/** One group as typed: letters and digits only, upper case, at most one group long. */
export const cleanGroup = (value: string): string =>
	value
		.replace(/[^0-9A-Za-z]/g, "")
		.toUpperCase()
		.slice(0, GROUP_LENGTH);

/**
 * What a paste fills in: the pasted text read the one way the key is read
 * (normalizeRecoveryText: case, hyphens, spaces, O and I and L), cut into
 * groups of six. A whole key fills all nine; anything shorter or longer fills
 * from the group it was pasted into, as far as it goes. Text the key reading
 * refuses (a non-ASCII character) fills nothing.
 */
export function pasteGroups(
	groups: readonly string[],
	from: number,
	text: string,
): readonly string[] {
	let clean: string;
	try {
		clean = normalizeRecoveryText(text);
	} catch {
		return groups;
	}
	const start = clean.length === GROUP_COUNT * GROUP_LENGTH ? 0 : from;
	const next = [...groups];
	for (let i = start; i < GROUP_COUNT; i++) {
		const at = (i - start) * GROUP_LENGTH;
		if (at >= clean.length) break;
		next[i] = clean.slice(at, at + GROUP_LENGTH);
	}
	return next;
}

/** All nine groups are full: the server and the checksum decide the rest. */
export const keyComplete = (state: Pick<RecoverState, "groups">): boolean =>
	state.groups.length === GROUP_COUNT &&
	state.groups.every((g) => g.length === GROUP_LENGTH);

/** The key as the core reads it (any separators; the core refuses a typo). */
export const recoverKeyText = (state: Pick<RecoverState, "groups">): string =>
	state.groups.join("-");

/** The new password is typed twice alike. Whether it meets the rules is the platform's to say (`rulesMet`). */
export const passwordsAlike = (
	state: Pick<RecoverState, "password" | "confirm">,
): boolean => state.password !== "" && state.password === state.confirm;

/** Nothing can be typed or tried: working, failed for good, or waiting on a commit that may have gone through. */
export const recoverFieldsLocked = (state: RecoverState): boolean =>
	state.busy || blocksRecoveryScreen(state.error) || state.unconfirmed;

export function recoverReducer(
	state: RecoverState,
	action: RecoverAction,
): RecoverState {
	if (action.type === "reset") return recoverInitialState(action.preset);
	// A blocking failure stays until the sheet closes (reset).
	if (blocksRecoveryScreen(state.error)) return state;
	switch (action.type) {
		case "group": {
			if (state.busy || state.step !== "enter") return state;
			const groups = [...state.groups];
			groups[action.index] = cleanGroup(action.value);
			return { ...state, groups, error: null };
		}
		case "paste":
			return state.busy || state.step !== "enter"
				? state
				: {
						...state,
						groups: pasteGroups(state.groups, action.from, action.text),
						error: null,
					};
		case "text":
			return state.busy || state.unconfirmed || state.step !== "password"
				? state
				: { ...state, [action.field]: action.value, error: null };
		case "busy":
			return state.busy ? state : { ...state, busy: true, error: null };
		case "proven":
			// Only the run that began at the key step may land.
			return state.step === "enter" && state.busy
				? { ...state, step: "password", busy: false, error: null }
				: state;
		case "failed": {
			// The proof or the keys no longer stand (the handle is stale): back to
			// the key, with the password gone.
			const stale = action.code === "wrongKey" || action.code === "keysChanged";
			return state.step === "password" && stale
				? {
						...state,
						step: "enter",
						password: "",
						confirm: "",
						busy: false,
						error: action.code,
						unconfirmed: false,
					}
				: {
						...state,
						busy: false,
						error: action.code,
						// Once a send is unconfirmed it stays so, whatever the retry says.
						unconfirmed:
							state.unconfirmed ||
							(state.step === "password" && action.code === "unconfirmed"),
					};
		}
	}
}

export type RecoverView = {
	/** Keys of the message catalog, from the root. */
	title: string;
	primary: string | null;
	primaryDisabled: boolean;
	/** The left button: Cancel, or Close once nothing can be tried. */
	left: "cancel" | "close";
};

/**
 * `rulesMet` says whether the typed new password meets the password rules
 * (`passwordMeetsRules` from api-contract), which the core does not import.
 */
export function recoverView(
	state: RecoverState,
	options: { rulesMet: boolean },
): RecoverView {
	const title =
		state.step === "enter"
			? "protection.recover.enterTitle"
			: "protection.recover.newPasswordTitle";
	if (blocksRecoveryScreen(state.error) && state.error !== "unavailable")
		return { title, primary: null, primaryDisabled: true, left: "close" };
	return {
		title,
		primary:
			state.step === "enter"
				? "protection.recover.continue"
				: "protection.recover.save",
		primaryDisabled:
			blocksRecoveryScreen(state.error) ||
			(state.step === "enter"
				? !keyComplete(state)
				: !(options.rulesMet && passwordsAlike(state))),
		left: "cancel",
	};
}
