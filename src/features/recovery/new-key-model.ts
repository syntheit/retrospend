// The Make new key sheet's states and rules, with no React and no network:
// which step shows, what it asks for, when Continue is allowed, what Back does
// and what each failure means. The sheet (new-key-sheet.tsx) only draws this
// and calls the callbacks it is given. The order: the current password, the
// new key shown, two groups typed back, then the save. The old key keeps
// working until the save commits, so nothing here is final until then.
import {
	type ConfirmGroups,
	isFinalRecoveryFailure,
	type RecoveryFailureCode,
} from "@retrospend/crypto/client";
import type { EnableView } from "~/features/settings/protection/enable-model";
import {
	groupsConfirmed,
	type KeyConfirmState,
} from "~/features/settings/protection/enable-model";

export type NewKeyStep = "password" | "saveKey" | "confirmKey";

export type NewKeyState = KeyConfirmState & {
	step: NewKeyStep;
	/** The current password. Gone as soon as the key is made. */
	current: string;
	busy: boolean;
	error: RecoveryFailureCode | null;
};

export const INITIAL_STATE: NewKeyState = {
	step: "password",
	current: "",
	keyText: "",
	groups: null,
	typed: ["", ""],
	busy: false,
	error: null,
};

export type NewKeyAction =
	| { type: "password"; value: string }
	| { type: "group"; index: 0 | 1; value: string }
	| { type: "busy" }
	| { type: "failed"; code: RecoveryFailureCode }
	| { type: "keyMade"; keyText: string }
	| { type: "savedIt"; groups: ConfirmGroups }
	| { type: "back" }
	| { type: "reset" };

/** Nothing can be typed, tried or changed: it is working, or it failed for good. */
export const fieldsLocked = (state: NewKeyState): boolean =>
	state.busy || isFinalRecoveryFailure(state.error);

export function newKeyReducer(
	state: NewKeyState,
	action: NewKeyAction,
): NewKeyState {
	// A final failure stays until the sheet closes (reset).
	if (isFinalRecoveryFailure(state.error) && action.type !== "reset")
		return state;
	switch (action.type) {
		case "reset":
			return INITIAL_STATE;
		case "password":
			return state.busy || state.step !== "password"
				? state
				: { ...state, current: action.value, error: null };
		case "group": {
			if (state.busy || state.step !== "confirmKey") return state;
			const typed: [string, string] = [state.typed[0], state.typed[1]];
			typed[action.index] = action.value;
			return { ...state, typed, error: null };
		}
		case "busy":
			return state.busy ? state : { ...state, busy: true, error: null };
		case "failed":
			// The keys changed under the run: the key made is stale, so start over.
			return action.code === "keysChanged"
				? { ...INITIAL_STATE, error: action.code }
				: { ...state, busy: false, error: action.code };
		case "keyMade":
			// Only the run that began at the password step may land.
			if (state.step !== "password" || !state.busy) return state;
			return { ...INITIAL_STATE, step: "saveKey", keyText: action.keyText };
		case "savedIt":
			return state.step === "saveKey" && !state.busy
				? {
						...state,
						step: "confirmKey",
						groups: action.groups,
						typed: ["", ""],
					}
				: state;
		case "back":
			return goBack(state);
	}
}

function goBack(state: NewKeyState): NewKeyState {
	if (state.busy) return state;
	switch (state.step) {
		case "saveKey":
			// The key was made for a password that is gone, so it goes with it.
			return { ...INITIAL_STATE };
		case "confirmKey":
			// The groups stay so the next pair is never this one (pickConfirmGroups).
			return { ...state, step: "saveKey", typed: ["", ""], error: null };
		default:
			return state;
	}
}

const TITLE: Record<NewKeyStep, string> = {
	password: "protection.newKey.title",
	saveKey: "protection.recoveryKey.saveTitle",
	confirmKey: "protection.recoveryKey.confirmTitle",
};

const PRIMARY: Record<NewKeyStep, string> = {
	password: "protection.newKey.continue",
	saveKey: "protection.recoveryKey.saved",
	confirmKey: "protection.newKey.save",
};

export function newKeyView(state: NewKeyState): EnableView {
	const title = TITLE[state.step];
	if (isFinalRecoveryFailure(state.error))
		return { title, left: "close", primary: null, primaryDisabled: true };
	return {
		title,
		left: state.step === "password" ? "cancel" : "back",
		primary: PRIMARY[state.step],
		primaryDisabled:
			state.step === "password"
				? state.current === ""
				: state.step === "confirmKey"
					? !groupsConfirmed(state)
					: false,
	};
}
