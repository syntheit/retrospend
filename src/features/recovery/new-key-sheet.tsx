"use client";

import {
	type KeyDraft,
	type NewKeyCallbacks,
	pickConfirmGroups,
	recoveryFailureOf,
} from "@retrospend/crypto/client";
import { useTranslations } from "next-intl";
import { useId, useReducer, useRef } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { EnableFooter } from "~/features/settings/protection/enable-footer";
import { groupsConfirmed } from "~/features/settings/protection/enable-model";
import {
	browserKeyActions,
	browserRandom,
	type KeyActions,
} from "~/features/settings/protection/recovery-key-actions";
import {
	ConfirmKeyStep,
	SaveKeyStep,
} from "~/features/settings/protection/recovery-key-steps";
import { useEnableLifecycle } from "~/features/settings/protection/use-enable-lifecycle";
import { useKeyFile } from "~/features/settings/protection/use-key-file";
import { useStepFocus } from "~/features/settings/protection/use-step-focus";
import {
	fieldsLocked,
	INITIAL_STATE,
	newKeyReducer,
	newKeyView,
} from "./new-key-model";
import { RecoveryError } from "./recovery-error";

export type NewKeySheetProps = NewKeyCallbacks & {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The account's email and the instant the key is made, for the saved file. */
	account: string;
	made: Date;
	/** The new key was saved and read back. */
	onDone?: () => void;
	/** Tests and other platforms; the browser's copy, file and print by default. */
	actions?: KeyActions;
	/** A number below `below`; tests pass their own. */
	random?: (below: number) => number;
};

function PasswordStep({
	value,
	locked,
	busy,
	error,
	onChange,
}: {
	value: string;
	locked: boolean;
	busy: boolean;
	error: Parameters<typeof RecoveryError>[0]["code"];
	onChange: (value: string) => void;
}) {
	const t = useTranslations("protection.newKey");
	const label = useTranslations("settingsV2.twoFactor");
	const id = useId();
	return (
		<div className="flex flex-col gap-4">
			<p className="text-fg-2 text-small">{t("body")}</p>
			<div className="flex flex-col gap-2">
				<Label htmlFor={id}>{label("password")}</Label>
				<Input
					autoComplete="current-password"
					disabled={locked}
					id={id}
					onChange={(e) => onChange(e.target.value)}
					type="password"
					value={value}
				/>
			</div>
			{busy ? (
				<p className="text-fg-3 text-small" role="status">
					{t("making")}
				</p>
			) : null}
			<RecoveryError code={error} />
		</div>
	);
}

/**
 * Make new key (the mockup's R1 and R2 behind the current password), one Sheet
 * with steps. It knows nothing of the server: the caller makes the key and
 * saves it. The old key stops working only when `save` resolves; closing wipes
 * the draft.
 */
export function NewKeySheet(props: NewKeySheetProps) {
	const t = useTranslations();
	const saving = useTranslations("protection.newKey");
	const [state, dispatch] = useReducer(newKeyReducer, INITIAL_STATE);
	const view = newKeyView(state);
	const body = useRef<HTMLDivElement>(null);
	const life = useEnableLifecycle<KeyDraft>({
		open: props.open,
		reset: () => dispatch({ type: "reset" }),
	});
	const file = useKeyFile(props.account, props.made);
	useStepFocus(body, state.step);

	const close = () => {
		if (life.canClose()) props.onOpenChange(false);
	};
	const fail = (error: unknown) => {
		const code = recoveryFailureOf(error);
		// A key made for keys that have since changed is stale.
		if (code === "keysChanged") life.drop();
		dispatch({ type: "failed", code });
	};
	const advance = async () => {
		if (state.busy || view.primaryDisabled) return;
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
			case "saveKey":
				return dispatch({
					type: "savedIt",
					groups: pickConfirmGroups(
						props.random ?? browserRandom,
						state.groups ?? undefined,
					),
				});
			case "confirmKey": {
				const draft = life.draft;
				if (!groupsConfirmed(state)) return;
				if (!draft) return dispatch({ type: "failed", code: "failed" });
				dispatch({ type: "busy" });
				const outcome = await life.run(() => props.save(draft));
				if (outcome.status === "done") {
					props.onDone?.();
					props.onOpenChange(false);
				} else if (outcome.status === "failed") fail(outcome.error);
			}
		}
	};
	const leave = () => {
		if (view.left === "back") {
			// Back from the key to the password makes the key stale.
			if (state.step === "saveKey") life.drop();
			dispatch({ type: "back" });
		} else close();
	};

	return (
		<Sheet
			detent="large"
			footer={
				<EnableFooter
					busy={state.busy}
					onLeft={leave}
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
				{state.step === "password" ? (
					<PasswordStep
						busy={state.busy}
						error={state.error}
						locked={fieldsLocked(state)}
						onChange={(value) => dispatch({ type: "password", value })}
						value={state.current}
					/>
				) : null}
				{state.step === "saveKey" ? (
					<SaveKeyStep
						actions={props.actions ?? browserKeyActions}
						file={file}
						keyText={state.keyText}
					/>
				) : null}
				{state.step === "confirmKey" ? (
					<div className="flex flex-col gap-4">
						<ConfirmKeyStep
							dispatch={dispatch}
							locked={fieldsLocked(state)}
							state={state}
						/>
						{state.busy ? (
							<p className="text-fg-3 text-small" role="status">
								{saving("saving")}
							</p>
						) : null}
						<RecoveryError code={state.error} />
					</div>
				) : null}
			</div>
		</Sheet>
	);
}
