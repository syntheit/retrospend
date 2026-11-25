import { passwordMeetsRules } from "@retrospend/api-contract";
import {
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
	recoveryFailureOf,
} from "@retrospend/crypto/client";
import { useReducer } from "react";
import { ScrollView } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { useEnableLifecycle } from "../settings/protection/useEnableLifecycle";
import { EnterKeyStep, NewPasswordStep } from "./RecoverSteps";

export type RecoverSheetProps = RecoveryCallbacks & {
	visible: boolean;
	onClose: () => void;
	/** A failure known before anything is typed (the link check found no recovery key on the account). */
	preset?: RecoveryFailureCode | null;
	/**
	 * The new password is set (`set`), or the link was found spent after a
	 * commit that got no answer (`linkSpent`): the caller sends the person to
	 * sign in and says so. It is also called for one that finished after the
	 * sheet was closed, because the password is set either way.
	 */
	onDone: (result: "set" | "linkSpent") => void;
};

/**
 * Use your recovery key and Set a new password (R3 and R4), one sheet with two
 * steps. It knows nothing of the server: the caller proves the key and
 * commits the password. The key is proven before the new password is asked
 * for; every exit (close, Cancel, a failure that ends the proof) wipes what the
 * proof opened.
 */
export function RecoverSheet(props: RecoverSheetProps) {
	const t = useTranslations();
	const tc = useTranslations("mobile.common");
	const { space } = useTheme();
	const body = useSheetBodySize({ footer: true });
	const preset = props.preset ?? null;
	const [state, dispatch] = useReducer(
		recoverReducer,
		preset,
		recoverInitialState,
	);
	const rulesMet = passwordMeetsRules(state.password);
	const view = recoverView(state, { rulesMet });
	const life = useEnableLifecycle<RecoveryHandle>({
		open: props.visible,
		reset: () => dispatch({ type: "reset", preset }),
	});

	function close() {
		life.closed();
		props.onClose();
	}
	function fail(error: unknown) {
		const code = recoveryFailureOf(error);
		if (endsRecoveryHandle(code)) life.drop();
		dispatch({ type: "failed", code });
	}
	async function advance() {
		if (life.running || view.primaryDisabled) return;
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
		if (!(rulesMet && passwordsAlike(state))) return;
		if (!handle) return dispatch({ type: "failed", code: "failed" });
		dispatch({ type: "busy" });
		const outcome = await life.run(() =>
			props.finish(handle, { password: state.password }),
		);
		if (outcome.status === "done") props.onDone(outcome.value);
		// The sheet was closed while the commit ran: the password is set all the same.
		else if (outcome.status === "late" && outcome.value)
			props.onDone(outcome.value);
		else if (outcome.status === "failed") fail(outcome.error);
	}

	const error = state.error
		? t(`protection.recover.errors.${state.error}`)
		: null;
	const locked = recoverFieldsLocked(state);
	const working =
		state.step === "enter"
			? t("protection.recover.checking")
			: t("protection.recover.saving");
	const footer = (
		<>
			<Button
				disabled={state.busy}
				label={view.left === "close" ? tc("close") : tc("cancel")}
				onPress={close}
				variant="text"
			/>
			{view.primary ? (
				<Button
					busy={state.busy}
					disabled={state.busy || view.primaryDisabled}
					label={state.busy ? working : t(view.primary)}
					onPress={() => void advance()}
					variant="filled"
				/>
			) : null}
		</>
	);

	return (
		<Sheet
			detents={["large"]}
			footer={footer}
			footerApart={false}
			onClose={close}
			title={t(view.title)}
			visible={props.visible}
		>
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
				keyboardShouldPersistTaps="handled"
				style={{ height: body.height }}
			>
				{state.step === "enter" ? (
					<EnterKeyStep
						dispatch={dispatch}
						error={error}
						locked={locked}
						state={state}
					/>
				) : (
					<NewPasswordStep
						dispatch={dispatch}
						error={error}
						locked={locked}
						state={state}
					/>
				)}
			</ScrollView>
		</Sheet>
	);
}
