"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { Notice } from "~/components/ui/notice";
import { Sheet } from "~/components/ui/sheet";
import type { WealthAccount } from "../types";

/**
 * Close: the account leaves your accounts and net worth from today; its
 * history stays and Closed accounts can reopen it. Delete permanently is a
 * separate, destructive action (the registry's named confirm).
 */
export function CloseAccountSheet({
	account,
	onOpenChange,
	onClose,
}: {
	account: WealthAccount;
	onOpenChange: (open: boolean) => void;
	onClose: () => Promise<void>;
}) {
	const t = useTranslations("wealthPage.sheets.close");
	return (
		<Sheet
			detent="medium"
			onOpenChange={onOpenChange}
			onSubmit={onClose}
			open
			submitLabel={t("submit")}
			title={t("title", { name: account.name })}
		>
			<p className="text-fg-2 text-body">{t("body", { name: account.name })}</p>
			{account.amount.minor !== 0 ? (
				<Notice className="mt-3" tone="attention">
					{t.rich("left", {
						amount: () => <Money value={account.amount} />,
					})}
				</Notice>
			) : null}
		</Sheet>
	);
}
