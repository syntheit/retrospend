import {
	ConfirmYouStep,
	DoneStep,
	MethodsStep,
	PasswordStep,
	StepError,
	WhatStep,
} from "./EnableSteps";
import { ConfirmKeyStep, SaveKeyStep } from "./KeySteps";
import type { EnableStep } from "./types";
import type { useKeyActions } from "./useKeyActions";

/** What the step in view shows. State and handlers are the sheet's; this only picks the screen. */
export function EnableBody({
	step,
	final,
	busy,
	error,
	go,
	twoFactor,
	next,
	password,
	code,
	setPassword,
	setCode,
	keyText,
	keySaved,
	keyActions,
	pair,
	typed,
	wrong,
	onType,
	onSeeWhich,
}: {
	step: EnableStep;
	final: boolean;
	busy: boolean;
	error: string | null;
	go: (to: EnableStep) => void;
	twoFactor: boolean;
	next: {
		value: string;
		again: string;
		set: (v: string) => void;
		setAgain: (v: string) => void;
	};
	password: string;
	code: string;
	setPassword: (v: string) => void;
	setCode: (v: string) => void;
	keyText: string | null;
	keySaved: boolean;
	keyActions: ReturnType<typeof useKeyActions>;
	pair: readonly [number, number] | null;
	typed: readonly [string, string];
	wrong: readonly [boolean, boolean];
	onType: (index: 0 | 1, value: string) => void;
	onSeeWhich?: () => void;
}) {
	if (final) return <StepError text={error} />;
	switch (step) {
		case "what":
			return <WhatStep onSeeWhich={onSeeWhich} />;
		case "password":
			return (
				<PasswordStep
					confirm={next.again}
					disabled={busy}
					error={error}
					next={next.value}
					onConfirm={next.setAgain}
					onNext={next.set}
				/>
			);
		case "methods":
			return (
				<MethodsStep keyDone={keySaved} onCreateKey={() => go("saveKey")} />
			);
		case "saveKey":
			return keyText ? (
				<SaveKeyStep
					error={error}
					keyText={keyText}
					onCopy={keyActions.copy}
					onSave={keyActions.save}
				/>
			) : null;
		case "confirmKey":
			return pair ? (
				<ConfirmKeyStep
					groups={pair}
					onType={onType}
					typed={typed}
					wrong={wrong}
				/>
			) : null;
		case "confirmYou":
			return (
				<ConfirmYouStep
					code={code}
					disabled={busy}
					error={error}
					onCode={setCode}
					onPassword={setPassword}
					password={password}
					twoFactor={twoFactor}
				/>
			);
		case "done":
			return <DoneStep />;
	}
}
