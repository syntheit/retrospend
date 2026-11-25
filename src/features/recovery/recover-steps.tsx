"use client";

import { useTranslations } from "next-intl";
import { useId, useRef } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { PasswordRules } from "~/features/settings/protection/password-rules";
import {
	GROUP_COUNT,
	GROUP_LENGTH,
	type RecoverAction,
	type RecoverState,
} from "./recover-model";
import { RecoveryError } from "./recovery-error";

/** The nine groups, by place: the key of each input is its place in the key. */
const GROUP_INDEXES = Array.from({ length: GROUP_COUNT }, (_, i) => i);

type StepProps = {
	state: RecoverState;
	dispatch: (action: RecoverAction) => void;
	locked: boolean;
};

/** R3: the key in nine inputs, or pasted whole into any of them. */
export function EnterKeyStep({ state, dispatch, locked }: StepProps) {
	const t = useTranslations("protection.recover");
	const group = useTranslations("protection.recoveryKey");
	const inputs = useRef<(HTMLInputElement | null)[]>([]);
	return (
		<div className="flex flex-col gap-4">
			<p className="text-fg-2 text-small">{t("enterBody")}</p>
			<div className="grid grid-cols-3 gap-2">
				{GROUP_INDEXES.map((index) => (
					<Input
						aria-label={group("group", { number: index + 1 })}
						autoCapitalize="characters"
						autoComplete="off"
						autoCorrect="off"
						className="text-center font-mono"
						disabled={locked}
						key={index}
						maxLength={GROUP_LENGTH}
						onChange={(e) => {
							dispatch({ type: "group", index, value: e.target.value });
							// A full group moves on to the next one.
							if (
								e.target.value.length >= GROUP_LENGTH &&
								index < GROUP_COUNT - 1
							)
								inputs.current[index + 1]?.focus();
						}}
						onPaste={(e) => {
							e.preventDefault();
							dispatch({
								type: "paste",
								from: index,
								text: e.clipboardData.getData("text"),
							});
						}}
						placeholder={group("group", { number: index + 1 })}
						ref={(node) => {
							inputs.current[index] = node;
						}}
						spellCheck={false}
						value={state.groups[index] ?? ""}
					/>
				))}
			</div>
			<RecoveryError code={state.error} />
		</div>
	);
}

/** R4: the new password, twice, with the rules. Only the browser ever sees it. */
export function NewPasswordStep({ state, dispatch, locked }: StepProps) {
	const t = useTranslations("protection.recover");
	const field = useTranslations("settingsV2.password");
	const newId = useId();
	const confirmId = useId();
	const set = (name: "password" | "confirm") => (value: string) =>
		dispatch({ type: "text", field: name, value });
	return (
		<div className="flex flex-col gap-4">
			<p className="text-fg-2 text-small">{t("newPasswordBody")}</p>
			<div className="flex flex-col gap-2">
				<Label htmlFor={newId}>{field("new")}</Label>
				<Input
					autoComplete="new-password"
					disabled={locked}
					id={newId}
					onChange={(e) => set("password")(e.target.value)}
					type="password"
					value={state.password}
				/>
			</div>
			<PasswordRules value={state.password} />
			<div className="flex flex-col gap-2">
				<Label htmlFor={confirmId}>{field("confirm")}</Label>
				<Input
					autoComplete="new-password"
					disabled={locked}
					id={confirmId}
					onChange={(e) => set("confirm")(e.target.value)}
					type="password"
					value={state.confirm}
				/>
			</div>
			{state.confirm !== "" && state.confirm !== state.password ? (
				<p className="text-danger text-meta">{field("mismatch")}</p>
			) : null}
			{state.busy ? (
				<p className="text-fg-3 text-small" role="status">
					{t("saving")}
				</p>
			) : null}
			<RecoveryError code={state.error} />
		</div>
	);
}
