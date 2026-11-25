"use client";

import { fieldsLocked } from "./enable-model";
import {
	MethodsStep,
	PasswordStep,
	type StepProps,
	WhatStep,
} from "./enable-steps";
import { ConfirmYouStep, DoneStep } from "./finish-steps";
import type { KeyActions, KeyFile } from "./recovery-key-actions";
import { ConfirmKeyStep, SaveKeyStep } from "./recovery-key-steps";

export type BodyProps = StepProps & {
	twoFactor: boolean;
	actions: KeyActions;
	file: KeyFile;
	onSeeWhich?: () => void;
};

/** The step the state is on. The sheet's title and footer come from enableView. */
export function EnableBody(props: BodyProps) {
	const { state, dispatch } = props;
	switch (state.step) {
		case "what":
			return <WhatStep onSeeWhich={props.onSeeWhich} />;
		case "newPassword":
			return <PasswordStep dispatch={dispatch} state={state} />;
		case "methods":
			return <MethodsStep dispatch={dispatch} state={state} />;
		case "saveKey":
			return (
				<SaveKeyStep
					actions={props.actions}
					file={props.file}
					keyText={state.keyText}
				/>
			);
		case "confirmKey":
			return (
				<ConfirmKeyStep
					dispatch={dispatch}
					locked={fieldsLocked(state)}
					state={state}
				/>
			);
		case "confirmYou":
			return (
				<ConfirmYouStep
					dispatch={dispatch}
					state={state}
					twoFactor={props.twoFactor}
				/>
			);
		case "done":
			return <DoneStep />;
	}
}
