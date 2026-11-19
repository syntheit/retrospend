"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { SheetChanges } from "~/components/ui/sheet-changes";
import { StatusDot } from "~/components/ui/status-dot";
import { SettingRow, SettingRows } from "../setting-row";
import type { EnableAction, EnableState } from "./enable-model";
import { PasswordRules } from "./password-rules";
import { StepError } from "./step-error";

export type StepProps = {
	state: EnableState;
	dispatch: (action: EnableAction) => void;
};

/** E1: what turning it on changes and what it does not (the mockup's two lists). */
export function WhatStep({ onSeeWhich }: { onSeeWhich?: () => void }) {
	const t = useTranslations("protection.enable.what");
	return (
		<div className="flex flex-col gap-4">
			<SheetChanges className="flex flex-col gap-2">
				<ul className="text-body text-fg *:border-line flex flex-col *:border-t *:py-2 *:first:border-t-0">
					<li>{t("body")}</li>
					<li>{t("shared")}</li>
					<li>{t("backups")}</li>
					<li className="flex items-baseline gap-2">
						{t("features")}
						{onSeeWhich ? (
							<Button kind="ghost" onClick={onSeeWhich} size="sm">
								{t("seeWhich")}
							</Button>
						) : null}
					</li>
				</ul>
			</SheetChanges>
			<SheetChanges className="flex flex-col gap-2" title={t("unchangedTitle")}>
				<p className="text-body text-fg">{t("unchanged")}</p>
			</SheetChanges>
		</div>
	);
}

/** E2: the new password, twice, with the rules. Only the browser ever sees it. */
export function PasswordStep({ state, dispatch }: StepProps) {
	const t = useTranslations("protection.enable.newPassword");
	const field = useTranslations("settingsV2.password");
	const newId = useId();
	const confirmId = useId();
	const set = (field: "password" | "confirm") => (value: string) =>
		dispatch({ type: "text", field, value });
	return (
		<div className="flex flex-col gap-4">
			<p className="text-fg-2 text-small">{t("body")}</p>
			<div className="flex flex-col gap-2">
				<Label htmlFor={newId}>{field("new")}</Label>
				<Input
					autoComplete="new-password"
					disabled={state.busy}
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
					disabled={state.busy}
					id={confirmId}
					onChange={(e) => set("confirm")(e.target.value)}
					type="password"
					value={state.confirm}
				/>
			</div>
			{state.confirm !== "" && state.confirm !== state.password ? (
				<p className="text-danger text-meta">{field("mismatch")}</p>
			) : null}
			<StepError code={state.error} />
		</div>
	);
}

/**
 * E3: the ways to get back in. The recovery key leads. The other two give the
 * reason they are not there yet (K0 decision 6): the control stays, it is
 * never hidden.
 */
export function MethodsStep({ state, dispatch }: StepProps) {
	const t = useTranslations("protection.methods");
	const body = useTranslations("protection.enable.methods");
	return (
		<div className="flex flex-col gap-4">
			<p className="text-fg-2 text-small">{body("body")}</p>
			<SettingRows label={body("title")}>
				<SettingRow label={t("key")} meta={t("keyBody")}>
					{state.keySaved ? (
						<StatusDot kind="confirmed" label={t("done")} />
					) : (
						<Button
							kind="primary"
							onClick={() => dispatch({ type: "createKey" })}
							size="sm"
						>
							{t("createKey")}
						</Button>
					)}
				</SettingRow>
				<SettingRow label={t("device")} meta={t("deviceBody")}>
					<span className="text-fg-3 text-small">{t("reason")}</span>
				</SettingRow>
				<SettingRow label={t("person")} meta={t("personBody")}>
					<span className="text-fg-3 text-small">{t("reason")}</span>
				</SettingRow>
			</SettingRows>
		</div>
	);
}
