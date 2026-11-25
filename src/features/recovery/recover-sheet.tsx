"use client";

import { passwordMeetsRules } from "@retrospend/api-contract";
import {
	asKeyFlowError,
	endsRecoveryHandle,
	keyComplete,
	passwordsAlike,
	type RecoveryCallbacks,
	type RecoveryFailureCode,
	type RecoveryHandle,
	recoverFieldsLocked,
	recoverInitialState,
	recoverKeyText,
	recoverReducer,
	recoverView,
	recoveryFailureFor,
} from "@retrospend/crypto/client";
import { useTranslations } from "next-intl";
import { useReducer, useRef } from "react";
import { Sheet } from "~/components/ui/sheet";
import { EnableFooter } from "~/features/settings/protection/enable-footer";
import { useEnableLifecycle } from "~/features/settings/protection/use-enable-lifecycle";
import { useStepFocus } from "~/features/settings/protection/use-step-focus";
import { EnterKeyStep, NewPasswordStep } from "./recover-steps";

export type RecoverSheetProps = RecoveryCallbacks & {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** A failure known before anything is typed (the link check found no recovery key on the account). */
	preset?: RecoveryFailureCode | null;
	/**
	 * The new password is set (`set`), or the link was found spent after a
	 * commit that got no answer (`linkSpent`): the caller sends the person to
	 * sign in and says which.
	 */
	onDone: (result: "set" | "linkSpent") => void;
};

/**
 * Use your recovery key and Set a new password (the mockup's R3 and R4), one
 * Sheet with two steps. It knows nothing of the server: the caller proves the
 * key and commits the password. The key is proven before the new password is
 * asked for; closing wipes what the proof opened.
 */
export function RecoverSheet(props: RecoverSheetProps) {
	const t = useTranslations();
	const preset = props.preset ?? null;
	const [state, dispatch] = useReducer(
		recoverReducer,
		preset,
		recoverInitialState,
	);
	const view = recoverView(state, {
		rulesMet: passwordMeetsRules(state.password),
	});
	const body = useRef<HTMLDivElement>(null);
	const life = useEnableLifecycle<RecoveryHandle>({
		open: props.open,
		reset: () => dispatch({ type: "reset", preset }),
	});
	useStepFocus(body, state.step);

	const close = () => {
		if (life.canClose()) props.onOpenChange(false);
	};
	const fail = (error: unknown) => {
		const flow = asKeyFlowError(error).code;
		if (endsRecoveryHandle(flow)) life.drop();
		dispatch({ type: "failed", code: recoveryFailureFor(flow) });
	};
	const advance = async () => {
		if (state.busy || view.primaryDisabled) return;
		if (state.step === "enter") {
			if (!keyComplete(state)) return;
			dispatch({ type: "busy" });
			const outcome = await life.makeDraft(() =>
				props.begin(recoverKeyText(state)),
			);
			if (outcome.status === "done") dispatch({ type: "proven" });
			else if (outcome.status === "failed") fail(outcome.error);
			return;
		}
		const handle = life.draft;
		if (!(passwordMeetsRules(state.password) && passwordsAlike(state))) return;
		if (!handle) return dispatch({ type: "failed", code: "failed" });
		dispatch({ type: "busy" });
		const outcome = await life.run(() =>
			props.finish(handle, { password: state.password }),
		);
		if (outcome.status === "done") props.onDone(outcome.value);
		else if (outcome.status === "failed") fail(outcome.error);
	};

	return (
		<Sheet
			detent="large"
			footer={
				<EnableFooter
					busy={state.busy}
					onLeft={close}
					onPrimary={() => void advance()}
					view={view}
				/>
			}
			onOpenChange={(open) => (open ? props.onOpenChange(true) : close())}
			onSubmit={async () => {
				await advance();
				return false;
			}}
			open={props.open}
			submitDisabled={view.primaryDisabled}
			title={t(view.title)}
		>
			<div ref={body}>
				{state.step === "enter" ? (
					<EnterKeyStep
						dispatch={dispatch}
						locked={recoverFieldsLocked(state)}
						state={state}
					/>
				) : (
					<NewPasswordStep
						dispatch={dispatch}
						locked={recoverFieldsLocked(state)}
						state={state}
					/>
				)}
			</div>
		</Sheet>
	);
}
