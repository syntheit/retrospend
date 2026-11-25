"use client";

import { useTranslations } from "next-intl";
import { AuthPanel } from "~/app/(site)/_components/auth-panel";
import { Button } from "~/components/ui/button";
import { SettingRow, SettingRows } from "~/features/settings/setting-row";

/** The mockup's danger text button: a ghost button whose words are the danger color (the filled danger button is only a destructive dialog's confirm). */
const DANGER_TEXT = "text-danger can-hover:hover:text-danger";

/**
 * X1 of the mockup: what a reset link leads to for an account with keys. The
 * recovery key leads. Another device and, with protection on, Reset account
 * give the reason they are not there yet (K0 decision 6): the control stays,
 * disabled. With protection off, the last row is today's reset, which removes
 * the keys.
 */
export function RecoveryChoices({
	protectionOn,
	onUseKey,
	onReset,
}: {
	protectionOn: boolean;
	onUseKey: () => void;
	onReset: () => void;
}) {
	const t = useTranslations("protection.recover.choose");
	const methods = useTranslations("protection.methods");
	return (
		<AuthPanel
			description={protectionOn ? t("bodyOn") : t("bodyOff")}
			title={protectionOn ? t("titleOn") : t("titleOff")}
		>
			<SettingRows label={protectionOn ? t("titleOn") : t("titleOff")}>
				<SettingRow label={methods("key")}>
					<Button kind="secondary" onClick={onUseKey} size="sm">
						{t("useKey")}
					</Button>
				</SettingRow>
				<SettingRow label={methods("device")}>
					<span className="text-fg-3 text-small">{methods("reason")}</span>
				</SettingRow>
				{protectionOn ? (
					<SettingRow label={t("nothingWorks")} meta={methods("reason")}>
						<Button className={DANGER_TEXT} disabled kind="ghost" size="sm">
							{t("resetAccount")}
						</Button>
					</SettingRow>
				) : (
					<SettingRow label={t("nothingWorks")} meta={t("resetMeta")}>
						<Button
							className={DANGER_TEXT}
							kind="ghost"
							onClick={onReset}
							size="sm"
						>
							{t("reset")}
						</Button>
					</SettingRow>
				)}
			</SettingRows>
		</AuthPanel>
	);
}
