"use client";

import { TWO_FACTOR_CODE_LENGTH } from "@retrospend/api-contract";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Input } from "~/components/ui/input";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSlot,
} from "~/components/ui/input-otp";
import { Label } from "~/components/ui/label";
import { Notice } from "~/components/ui/notice";
import { fieldsLocked } from "./enable-model";
import type { StepProps } from "./enable-steps";
import { StepError } from "./step-error";

const CODE_SLOTS = Array.from({ length: TWO_FACTOR_CODE_LENGTH }, (_, i) => i);

/**
 * Confirm it's you: the current password, and the two-factor code when it is
 * on. Nothing is sent before Save keys, and nothing here is kept after it.
 */
export function ConfirmYouStep({
	state,
	dispatch,
	twoFactor,
}: StepProps & { twoFactor: boolean }) {
	const t = useTranslations("protection.enable.confirmYou");
	const label = useTranslations("settingsV2.twoFactor");
	const passwordId = useId();
	const codeId = useId();
	// Working, or failed for good: the fields stay on screen and cannot be used.
	const locked = fieldsLocked(state);
	return (
		<div className="flex flex-col gap-4">
			<p className="text-fg-2 text-small">{t("body")}</p>
			<div className="flex flex-col gap-2">
				<Label htmlFor={passwordId}>{label("password")}</Label>
				<Input
					autoComplete="current-password"
					disabled={locked}
					id={passwordId}
					onChange={(e) =>
						dispatch({
							type: "text",
							field: "current",
							value: e.target.value,
						})
					}
					type="password"
					value={state.current}
				/>
			</div>
			{twoFactor ? (
				<div className="flex flex-col gap-2">
					<Label htmlFor={codeId}>{label("code")}</Label>
					<InputOTP
						disabled={locked}
						id={codeId}
						maxLength={TWO_FACTOR_CODE_LENGTH}
						onChange={(value) =>
							dispatch({ type: "text", field: "code", value })
						}
						value={state.code}
					>
						<InputOTPGroup>
							{CODE_SLOTS.map((i) => (
								<InputOTPSlot index={i} key={i} />
							))}
						</InputOTPGroup>
					</InputOTP>
				</div>
			) : null}
			<StepError code={state.error} />
		</div>
	);
}

/**
 * The end. Nothing is sealed yet (K1 decision 1, K1-c review): the K0 copy
 * speaks of sealed data in the present tense, so this notice says what is true
 * until Advanced protection can turn on.
 */
export function DoneStep() {
	const t = useTranslations("protection.enable");
	return <Notice tone="info">{t("notice")}</Notice>;
}
