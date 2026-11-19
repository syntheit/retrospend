"use client";

import { pickConfirmGroups, randomBelow } from "@retrospend/crypto/client";
import { useTranslations } from "next-intl";
import { useEffect, useReducer, useRef } from "react";
import { Sheet } from "~/components/ui/sheet";
import { EnableBody } from "./enable-body";
import { EnableFooter } from "./enable-footer";
import {
	enableReducer,
	enableView,
	failureCode,
	INITIAL_STATE,
} from "./enable-model";
import {
	browserKeyActions,
	type KeyActions,
	type KeyFile,
} from "./recovery-key-actions";
import { useEnableLifecycle } from "./use-enable-lifecycle";

export type EnableSheetProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Two-factor is on, so Confirm it's you also asks for a code. */
	twoFactor: boolean;
	/** The account's email and the instant the keys are made, for the saved file. */
	account: string;
	made: Date;
	/**
	 * New password step: derive and wrap, and resolve with the recovery key's
	 * text. Reject with an EnableFailure (anything else reads as `failed`). The
	 * password is dropped from this sheet the moment the keys exist.
	 */
	makeKeys: (password: string) => Promise<string>;
	/** Confirm it's you: send the keys, read them back, resolve when they check. Reject with an EnableFailure. */
	save: (input: { password: string; code: string | null }) => Promise<void>;
	/** The keys made so far are no longer wanted: wipe them. Called on close, on Back to the password and on unmount. */
	discard: () => void;
	/** The person pressed Done on the last step. */
	onDone?: () => void;
	/** Opens the list of features that turn off. The link is not shown without it. */
	onSeeWhich?: () => void;
	/** Tests and other platforms; the browser's copy, file and print by default. */
	actions?: KeyActions;
	/** A number below `below`; tests pass their own. */
	random?: (below: number) => number;
};

const browserRandom = (below: number) =>
	randomBelow(
		{ randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)) },
		below,
	);

/**
 * Turn on Advanced protection (E1 to E3, R1, R2 and Confirm it's you of the
 * mockup), one Sheet with steps. It knows nothing of the server: the caller
 * makes the keys and saves them (K1a-2 wires them). Closing wipes the draft.
 */
export function EnableSheet(props: EnableSheetProps) {
	const t = useTranslations();
	const rk = useTranslations("protection.recoveryKey");
	const [state, dispatch] = useReducer(enableReducer, INITIAL_STATE);
	const view = enableView(state, { twoFactor: props.twoFactor });
	const body = useRef<HTMLDivElement>(null);
	const life = useEnableLifecycle({
		open: props.open,
		discard: props.discard,
		reset: () => dispatch({ type: "reset" }),
	});
	const file: KeyFile = {
		labels: {
			title: rk("fileTitle"),
			account: rk("fileAccount"),
			made: rk("fileMade"),
			key: rk("label"),
			keepSafe: rk("saveBody"),
		},
		account: props.account,
		made: props.made,
	};

	// The step that held focus is gone: focus lands on the new step's first control.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on a step change only
	useEffect(() => {
		body.current
			?.querySelector<HTMLElement>("input, button:not([disabled])")
			?.focus({ preventScroll: true });
	}, [state.step]);

	const close = () => {
		if (life.canClose()) props.onOpenChange(false);
	};
	// A job that outlives the sheet (closed or unmounted meanwhile) lands nowhere.
	const run = async <T,>(job: () => Promise<T>, done: (value: T) => void) => {
		if (life.running) return;
		dispatch({ type: "busy" });
		const outcome = await life.run(job);
		if (outcome.status === "done") done(outcome.value);
		else if (outcome.status === "failed")
			dispatch({ type: "failed", code: failureCode(outcome.error) });
	};
	const advance = async () => {
		if (state.busy || view.primaryDisabled) return;
		switch (state.step) {
			case "what":
			case "methods":
				return dispatch({ type: "forward" });
			case "saveKey":
				return dispatch({
					type: "savedIt",
					groups: pickConfirmGroups(
						props.random ?? browserRandom,
						state.groups ?? undefined,
					),
				});
			case "confirmKey":
				return dispatch({ type: "keyConfirmed" });
			case "newPassword":
				return run(
					() => props.makeKeys(state.password),
					(keyText) => dispatch({ type: "keysMade", keyText }),
				);
			case "confirmYou":
				return run(
					() =>
						props.save({
							password: state.current,
							code: props.twoFactor ? state.code : null,
						}),
					() => dispatch({ type: "saved" }),
				);
			case "done":
				props.onDone?.();
				return close();
		}
	};
	const leave = () => {
		if (view.left === "back") {
			life.back(state.step);
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
				<EnableBody
					actions={props.actions ?? browserKeyActions}
					dispatch={dispatch}
					file={file}
					onSeeWhich={props.onSeeWhich}
					state={state}
					twoFactor={props.twoFactor}
				/>
			</div>
		</Sheet>
	);
}
