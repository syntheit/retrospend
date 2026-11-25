import {
	groupMismatch,
	groupsConfirmed,
	type KeyDraft,
	NEW_KEY_INITIAL_STATE,
	type NewKeyCallbacks,
	newKeyFieldsLocked,
	newKeyReducer,
	newKeyView,
	pickConfirmGroups,
	randomBelow,
	recoveryFailureOf,
} from "@retrospend/crypto/client";
import { useReducer, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { getPrimitives } from "@/crypto/native";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";
import { StepError } from "./EnableSteps";
import { ConfirmKeyStep, SaveKeyStep } from "./KeySteps";
import { useEnableLifecycle } from "./useEnableLifecycle";
import { useKeyActions } from "./useKeyActions";

export type NewKeySheetProps = NewKeyCallbacks & {
	visible: boolean;
	onClose: () => void;
	/** The account's email, written into the saved key file. */
	account: string;
	/** The new key was saved and read back. */
	onDone?: () => void;
	/** Tests only: the choice of which two groups to ask for. */
	random?: (below: number) => number;
};

/** The default draw: the primitives' random bytes, unbiased (randomBelow). */
async function drawWith(): Promise<(below: number) => number> {
	const p = await getPrimitives();
	return (below) => randomBelow(p, below);
}

/**
 * Make new key (R1 and R2 behind the current password), one sheet with steps.
 * It knows nothing of the server: the caller makes the key and saves it. The
 * old key stops working only when `save` resolves; every exit wipes the draft.
 */
export function NewKeySheet(props: NewKeySheetProps) {
	// The shared views name their words as catalog keys from the root.
	const t = useTranslations() as (
		key: string,
		values?: Record<string, string | number>,
	) => string;
	const tc = useTranslations("mobile.common");
	const ts = useTranslations("mobile.signIn");
	const toast = useToast();
	const { space } = useTheme();
	const body = useSheetBodySize({ footer: true });
	const [state, dispatch] = useReducer(newKeyReducer, NEW_KEY_INITIAL_STATE);
	const [actionError, setActionError] = useState<string | null>(null);
	const view = newKeyView(state);
	// Moves when the sheet closes, so a copy or save started before is stale.
	const session = useRef(0);
	const life = useEnableLifecycle<KeyDraft>({
		open: props.visible,
		reset: () => {
			session.current += 1;
			dispatch({ type: "reset" });
			setActionError(null);
		},
	});
	const keyActions = useKeyActions({
		keyText: state.keyText === "" ? null : state.keyText,
		account: props.account,
		setError: setActionError,
		session,
	});

	function close() {
		life.closed();
		props.onClose();
	}
	function fail(error: unknown) {
		const code = recoveryFailureOf(error);
		// A key made for keys that have since changed is stale.
		if (code === "keysChanged") life.drop();
		dispatch({ type: "failed", code });
	}
	async function advance() {
		if (life.running || view.primaryDisabled) return;
		switch (state.step) {
			case "password": {
				dispatch({ type: "busy" });
				const outcome = await life.makeDraft(() =>
					props.makeKey(state.current),
				);
				if (outcome.status === "done")
					dispatch({ type: "keyMade", keyText: outcome.value.keyText });
				else if (outcome.status === "failed") fail(outcome.error);
				return;
			}
			case "saveKey": {
				// Back from the confirm step draws two new groups (K0 decision 1).
				const draw = props.random ?? (await drawWith());
				dispatch({
					type: "savedIt",
					groups: pickConfirmGroups(draw, state.groups ?? undefined),
				});
				return;
			}
			case "confirmKey": {
				const draft = life.draft;
				if (!groupsConfirmed(state)) return;
				if (!draft) return dispatch({ type: "failed", code: "failed" });
				dispatch({ type: "busy" });
				const outcome = await life.run(() => props.save(draft));
				if (outcome.status === "done") {
					toast.show({ message: t("protection.toast.newKeySaved") });
					props.onDone?.();
					close();
				} else if (outcome.status === "failed") fail(outcome.error);
			}
		}
	}
	function leave() {
		if (view.left !== "back") return close();
		// Back from the key to the password makes the key stale.
		if (state.step === "saveKey") life.drop();
		setActionError(null);
		dispatch({ type: "back" });
	}

	const failure = state.error
		? t(`protection.recover.errors.${state.error}`)
		: null;
	const locked = newKeyFieldsLocked(state);
	const working =
		state.step === "password"
			? t("protection.newKey.making")
			: t("protection.newKey.saving");
	const footer = (
		<>
			<Button
				disabled={state.busy}
				label={
					view.left === "back"
						? t("protection.enable.back")
						: view.left === "close"
							? tc("close")
							: tc("cancel")
				}
				onPress={leave}
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
				{state.step === "password" ? (
					<View style={{ gap: space[4] }}>
						<Text tone="fg2">{t("protection.newKey.body")}</Text>
						<TextField
							autoComplete="current-password"
							disabled={locked}
							label={ts("password")}
							onChangeText={(value) => dispatch({ type: "password", value })}
							secure
							value={state.current}
						/>
						<StepError text={failure} />
					</View>
				) : null}
				{state.step === "saveKey" ? (
					<SaveKeyStep
						error={actionError}
						keyText={state.keyText}
						onCopy={keyActions.copy}
						onSave={keyActions.save}
					/>
				) : null}
				{state.step === "confirmKey" && state.groups ? (
					<View style={{ gap: space[4] }}>
						<ConfirmKeyStep
							groups={state.groups}
							onType={(index, value) =>
								dispatch({ type: "group", index, value })
							}
							typed={state.typed}
							wrong={[groupMismatch(state, 0), groupMismatch(state, 1)]}
						/>
						<StepError text={failure} />
					</View>
				) : null}
			</ScrollView>
		</Sheet>
	);
}
