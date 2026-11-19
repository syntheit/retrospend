import { pickConfirmGroups, randomBelow } from "@retrospend/crypto/client";
import { useEffect, useRef, useState } from "react";
import { ScrollView } from "react-native";
import { useTranslations } from "use-intl";
import { getPrimitives } from "@/crypto/native";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { useToast } from "@/ui/Toast";
import {
	ConfirmYouStep,
	DoneStep,
	MethodsStep,
	PasswordStep,
	passwordStepReady,
	StepError,
	WhatStep,
} from "./EnableSteps";
import { ConfirmKeyStep, confirmMatches, SaveKeyStep } from "./KeySteps";
import { copyRecoveryKey, saveRecoveryKeyFile } from "./recoveryKeyActions";
import {
	type ConfirmFailure,
	type ConfirmResult,
	type EnableStep,
	isFinal,
	type MakeKeysResult,
} from "./types";

type Pair = readonly [number, number];

export type EnableSheetProps = {
	visible: boolean;
	/** The sheet was closed (the X, back or Cancel); the draft is already dropped. */
	onClose: () => void;
	/** The account's email, written into the saved key file. */
	account: string;
	/** Two-factor is on: the last step asks for a code too. */
	twoFactor: boolean;
	/** E2 Continue: derive the keys once (a busy moment) and answer with the key text. */
	makeKeys: (password: string) => Promise<MakeKeysResult>;
	/** Last step: sign in again if needed, send, read back. Never throws. */
	confirm: (input: {
		password: string;
		code: string;
	}) => Promise<ConfirmResult>;
	/** Drop the keys made at E2: Back from the methods, close, cancel, and after the end. */
	discard: () => void;
	/** E1's "See which": where the locked features are listed. Without it the link is not drawn. */
	onSeeWhich?: () => void;
	/** Tests only: the choice of which two groups to ask for. */
	random?: (below: number) => number;
};

const TITLES = {
	what: "enable.what.title",
	password: "enable.newPassword.title",
	methods: "enable.methods.title",
	saveKey: "recoveryKey.saveTitle",
	confirmKey: "recoveryKey.confirmTitle",
	confirmYou: "enable.confirmYou.title",
	done: "toast.keysSaved",
} as const satisfies Record<EnableStep, string>;

/** The default draw: the primitives' random bytes, unbiased (randomBelow). */
async function drawWith(): Promise<(below: number) => number> {
	const p = await getPrimitives();
	return (below) => randomBelow(p, below);
}

/**
 * Turning on Advanced protection, the phone's steps in one sheet: what changes,
 * a new password, a way back in (the recovery key: save it, retype two groups),
 * then the password again to save the keys. The sheet only shows steps and
 * calls back: making the keys, sending them and the read-back are the
 * caller's. Nothing typed or made stays in a closed sheet: closing, Cancel and
 * Back past the key all drop it. The sheet ends at "keys ready", not "on".
 */
export function EnableSheet({
	visible,
	onClose,
	account,
	twoFactor,
	makeKeys,
	confirm,
	discard,
	onSeeWhich,
	random,
}: EnableSheetProps) {
	const t = useTranslations("protection");
	const tc = useTranslations("mobile.common");
	const toast = useToast();
	const { space } = useTheme();
	const body = useSheetBodySize({ footer: true });
	const [step, setStep] = useState<EnableStep>("what");
	const [next, setNext] = useState("");
	const [again, setAgain] = useState("");
	const [keyText, setKeyText] = useState<string | null>(null);
	const [keySaved, setKeySaved] = useState(false);
	const [pair, setPair] = useState<Pair | null>(null);
	const [typed, setTyped] = useState<readonly [string, string]>(["", ""]);
	const [wrong, setWrong] = useState<readonly [boolean, boolean]>([
		false,
		false,
	]);
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [final, setFinal] = useState(false);
	// A run that outlives the sheet (closed during the Argon2id moment or the
	// send) must not write into the next opening.
	const run = useRef(0);

	function reset() {
		run.current += 1;
		setStep("what");
		setNext("");
		setAgain("");
		setKeyText(null);
		setKeySaved(false);
		setPair(null);
		setTyped(["", ""]);
		setWrong([false, false]);
		setPassword("");
		setCode("");
		setBusy(false);
		setError(null);
		setFinal(false);
	}

	// Closed from outside (the parent hides it): the same as the X.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `visible` is the trigger
	useEffect(() => {
		if (!visible) {
			reset();
			discard();
		}
	}, [visible]);

	function close() {
		reset();
		discard();
		onClose();
	}

	function go(to: EnableStep) {
		setError(null);
		setStep(to);
	}

	async function makeThem() {
		if (busy || !passwordStepReady(next, again)) return;
		const mine = ++run.current;
		setBusy(true);
		setError(null);
		const made = await makeKeys(next).catch(
			(): MakeKeysResult => ({ ok: false }),
		);
		if (mine !== run.current) return;
		setBusy(false);
		if (!made.ok) {
			setError(t("errors.failed"));
			return;
		}
		// The new password is not needed again: the keys are made.
		setNext("");
		setAgain("");
		setKeyText(made.recoveryKeyText);
		go("methods");
	}

	function backToPassword() {
		discard();
		setKeyText(null);
		setKeySaved(false);
		setPair(null);
		go("password");
	}

	async function confirmGroups() {
		// Back from the confirm step draws two new groups (K0 decision 1).
		const draw = random ?? (await drawWith());
		setPair((was) => pickConfirmGroups(draw, was ?? undefined));
		setTyped(["", ""]);
		setWrong([false, false]);
		go("confirmKey");
	}

	function checkGroups() {
		if (!keyText || !pair) return;
		const [a, b] = confirmMatches(keyText, pair, typed);
		setWrong([!a, !b]);
		if (a && b) {
			setKeySaved(true);
			go("methods");
		}
	}

	async function copy() {
		if (!keyText) return;
		setError(null);
		try {
			await copyRecoveryKey(keyText);
		} catch {
			setError(t("errors.failed"));
		}
	}

	async function save() {
		if (!keyText) return;
		setError(null);
		try {
			const labels = {
				title: t("recoveryKey.fileTitle"),
				account: t("recoveryKey.fileAccount"),
				made: t("recoveryKey.fileMade"),
				key: t("recoveryKey.label"),
				keepSafe: t("recoveryKey.saveBody"),
			};
			if (!(await saveRecoveryKeyFile(labels, { keyText, account })))
				setError(t("errors.failed"));
		} catch {
			setError(t("errors.failed"));
		}
	}

	async function submit() {
		if (busy || password === "" || (twoFactor && code === "")) return;
		const mine = ++run.current;
		setBusy(true);
		setError(null);
		const done = await confirm({ password, code }).catch(
			(): ConfirmResult => ({ ok: false, reason: "failed" }),
		);
		if (mine !== run.current) return;
		setBusy(false);
		if (done.ok) {
			// Saved and confirmed: nothing on this screen needs the key again.
			setPassword("");
			setCode("");
			setKeyText(null);
			go("done");
			return;
		}
		setError(t(`errors.${done.reason satisfies ConfirmFailure}`));
		setFinal(isFinal(done.reason));
	}

	function finish() {
		toast.show({ message: t("toast.keysSaved") });
		close();
	}

	const ready =
		step === "password"
			? passwordStepReady(next, again)
			: step === "confirmKey"
				? typed[0] !== "" && typed[1] !== ""
				: step === "methods"
					? keySaved
					: step === "confirmYou"
						? password !== "" && (!twoFactor || code !== "")
						: true;

	const primary = (label: string, onPress: () => void, working?: string) => (
		<Button
			busy={busy}
			disabled={busy || !ready}
			label={busy && working ? working : label}
			onPress={onPress}
			variant="filled"
		/>
	);
	const secondary = (label: string, onPress: () => void) => (
		<Button disabled={busy} label={label} onPress={onPress} variant="text" />
	);

	const footer = final ? (
		secondary(tc("close"), close)
	) : step === "what" ? (
		<>
			{secondary(tc("cancel"), close)}
			{primary(t("enable.what.continue"), () => go("password"))}
		</>
	) : step === "password" ? (
		<>
			{secondary(tc("back"), () => go("what"))}
			{primary(t("enable.newPassword.continue"), makeThem, t("enable.making"))}
		</>
	) : step === "methods" ? (
		<>
			{secondary(tc("back"), backToPassword)}
			{primary(t("enable.methods.continue"), () => go("confirmYou"))}
		</>
	) : step === "saveKey" ? (
		<>
			{secondary(tc("back"), () => go("methods"))}
			{primary(t("recoveryKey.saved"), confirmGroups)}
		</>
	) : step === "confirmKey" ? (
		<>
			{secondary(tc("back"), () => go("saveKey"))}
			{primary(t("enable.methods.continue"), checkGroups)}
		</>
	) : step === "confirmYou" ? (
		<>
			{secondary(tc("back"), () => go("methods"))}
			{primary(t("enable.confirmYou.continue"), submit, tc("saving"))}
		</>
	) : (
		primary(tc("done"), finish)
	);

	return (
		<Sheet
			detents={["large"]}
			footer={footer}
			footerApart={false}
			onClose={close}
			title={t(TITLES[step])}
			visible={visible}
		>
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
				keyboardShouldPersistTaps="handled"
				style={{ height: body.height }}
			>
				{final ? (
					<StepError text={error} />
				) : step === "what" ? (
					<WhatStep onSeeWhich={onSeeWhich} />
				) : step === "password" ? (
					<PasswordStep
						confirm={again}
						disabled={busy}
						error={error}
						next={next}
						onConfirm={setAgain}
						onNext={setNext}
					/>
				) : step === "methods" ? (
					<MethodsStep keyDone={keySaved} onCreateKey={() => go("saveKey")} />
				) : step === "saveKey" && keyText ? (
					<SaveKeyStep
						error={error}
						keyText={keyText}
						onCopy={copy}
						onSave={save}
					/>
				) : step === "confirmKey" && pair ? (
					<ConfirmKeyStep
						groups={pair}
						onType={(i, v) => {
							setTyped((was) => (i === 0 ? [v, was[1]] : [was[0], v]));
							setWrong([false, false]);
						}}
						typed={typed}
						wrong={wrong}
					/>
				) : step === "confirmYou" ? (
					<ConfirmYouStep
						code={code}
						disabled={busy}
						error={error}
						onCode={setCode}
						onPassword={setPassword}
						password={password}
						twoFactor={twoFactor}
					/>
				) : step === "done" ? (
					<DoneStep />
				) : null}
			</ScrollView>
		</Sheet>
	);
}
