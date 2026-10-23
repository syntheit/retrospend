"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { SectionShell } from "../section-shell";
import { SettingRow, SettingRows } from "../setting-row";
import { DeleteAccountSheet } from "./delete-account-sheet";

/** Danger zone: Delete account, red text, opening the two-step sheet. */
export function DangerSection() {
	const t = useTranslations("settingsV2.delete");
	const [open, setOpen] = useState(false);
	return (
		<SectionShell id="danger" title={t("section")}>
			<SettingRows>
				<SettingRow label={t("title")} meta={t("rowMeta")}>
					<Button
						className="text-danger can-hover:hover:text-danger"
						kind="secondary"
						onClick={() => setOpen(true)}
						size="sm"
					>
						{t("title")}
					</Button>
				</SettingRow>
			</SettingRows>
			<DeleteAccountSheet onOpenChange={setOpen} open={open} />
		</SectionShell>
	);
}
