"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { useSession } from "~/hooks/use-session";
import { SectionShell } from "../section-shell";
import { SettingRow, SettingRows } from "../setting-row";
import { PasswordSheet } from "./password-sheet";
import { TwoFactorOnSheet } from "./two-factor-on-sheet";
import { BackupCodesSheet, TwoFactorOffSheet } from "./two-factor-sheets";

type Open = "password" | "tfaOn" | "tfaOff" | "codes" | null;

/** Security: Change password, and two-factor on or off with backup codes. */
export function SecuritySection() {
	const t = useTranslations("settingsV2.security");
	const { data: session, refetch } = useSession();
	const [open, setOpen] = useState<Open>(null);
	const on = !!session?.user.twoFactorEnabled;
	const sheet = (name: Exclude<Open, null>) => ({
		open: open === name,
		onOpenChange: (o: boolean) => setOpen(o ? name : null),
	});

	return (
		<SectionShell id="security" title={t("title")}>
			<SettingRows>
				<SettingRow label={t("password")} meta={t("passwordMeta")}>
					<Button
						kind="secondary"
						onClick={() => setOpen("password")}
						size="sm"
					>
						{t("changePassword")}
					</Button>
				</SettingRow>
				<SettingRow
					label={t("twoFactor")}
					meta={on ? t("twoFactorOn") : t("twoFactorOff")}
				>
					{on ? (
						<>
							<Button
								kind="secondary"
								onClick={() => setOpen("codes")}
								size="sm"
							>
								{t("backupCodes")}
							</Button>
							<Button
								kind="secondary"
								onClick={() => setOpen("tfaOff")}
								size="sm"
							>
								{t("turnOff")}
							</Button>
						</>
					) : (
						<Button kind="secondary" onClick={() => setOpen("tfaOn")} size="sm">
							{t("turnOn")}
						</Button>
					)}
				</SettingRow>
			</SettingRows>
			<PasswordSheet {...sheet("password")} />
			<TwoFactorOnSheet {...sheet("tfaOn")} onDone={refetch} />
			<TwoFactorOffSheet {...sheet("tfaOff")} onDone={refetch} />
			<BackupCodesSheet {...sheet("codes")} />
		</SectionShell>
	);
}
