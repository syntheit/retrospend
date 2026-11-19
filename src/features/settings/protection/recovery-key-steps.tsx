"use client";

import { recoveryKeyGroups } from "@retrospend/crypto/client";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useToast } from "~/components/ui/toast";
import { fieldsLocked, groupMismatch } from "./enable-model";
import type { StepProps } from "./enable-steps";
import {
	copyRecoveryKey,
	type KeyActions,
	type KeyFile,
	keyFileText,
} from "./recovery-key-actions";
import { StepError } from "./step-error";

/** R1: the key in nine groups, and the ways to keep it. Shown once; it is not read back from the server. */
export function SaveKeyStep({
	state,
	actions,
	file,
}: Pick<StepProps, "state"> & { actions: KeyActions; file: KeyFile }) {
	const t = useTranslations("protection.recoveryKey");
	const toast = useToast();
	const [copyFailed, setCopyFailed] = useState(false);
	const copy = async () => {
		const copied = await copyRecoveryKey(actions, state.keyText);
		setCopyFailed(!copied);
		if (copied) toast.saved(t("copied"));
	};
	const items = recoveryKeyGroups(state.keyText).map((group, i) => ({
		group,
		number: i + 1,
	}));
	return (
		<div className="flex flex-col gap-4">
			<p className="text-fg-2 text-small">{t("saveBody")}</p>
			<fieldset className="rounded-ctl bg-raised grid grid-cols-3 gap-x-4 gap-y-3 p-4">
				<legend className="sr-only">{t("label")}</legend>
				{items.map(({ group, number }) => (
					<span className="flex flex-col gap-1" key={number}>
						<span className="text-fg-3 text-meta">
							{t("group", { number })}
						</span>
						<span className="text-small font-mono">{group}</span>
					</span>
				))}
			</fieldset>
			<div className="flex flex-wrap gap-2">
				<Button kind="secondary" onClick={() => void copy()} size="sm">
					{t("copy")}
				</Button>
				<Button
					kind="secondary"
					onClick={() => actions.download(keyFileText(file, state.keyText))}
					size="sm"
				>
					{t("download")}
				</Button>
				<Button
					kind="secondary"
					onClick={() => actions.print(keyFileText(file, state.keyText))}
					size="sm"
				>
					{t("print")}
				</Button>
			</div>
			<StepError code={copyFailed ? "failed" : null} />
		</div>
	);
}

/** R2: type two of the nine groups back. Which two is chosen when the step opens (see pickConfirmGroups). */
export function ConfirmKeyStep({ state, dispatch }: StepProps) {
	const t = useTranslations("protection.recoveryKey");
	const ids = [useId(), useId()] as const;
	const [first, second] = state.groups ?? [0, 1];
	const locked = fieldsLocked(state);
	return (
		<div className="flex flex-col gap-4">
			<p className="text-fg-2 text-small">
				{t("confirmBody", { first: first + 1, second: second + 1 })}
			</p>
			<div className="grid grid-cols-2 gap-4">
				{([first, second] as const).map((at, i) => {
					const index = i === 0 ? 0 : 1;
					const wrong = groupMismatch(state, index);
					return (
						<div className="flex flex-col gap-2" key={at}>
							<Label htmlFor={ids[index]}>
								{t("group", { number: at + 1 })}
							</Label>
							<Input
								aria-describedby={wrong ? `${ids[index]}-error` : undefined}
								aria-invalid={wrong || undefined}
								autoCapitalize="characters"
								autoComplete="off"
								autoCorrect="off"
								className="font-mono"
								disabled={locked}
								id={ids[index]}
								onChange={(e) =>
									dispatch({ type: "group", index, value: e.target.value })
								}
								spellCheck={false}
								value={state.typed[index]}
							/>
							{wrong ? (
								<p className="text-danger text-meta" id={`${ids[index]}-error`}>
									{t("mismatch")}
								</p>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}
