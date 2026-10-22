"use client";

import { ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "~/components/ui/collapsible";

export interface ClosedAccount {
	id: string;
	name: string;
	closedAt: Date;
}

/**
 * Closed accounts, collapsed under the wealth table. They are out of every
 * total but still part of the net worth history; each can be reopened or
 * deleted for good.
 */
export function ClosedAccounts({
	accounts,
	onReopen,
	onDeletePermanently,
	pendingId,
}: {
	accounts: ClosedAccount[];
	onReopen: (id: string) => void;
	onDeletePermanently: (account: ClosedAccount) => void;
	/** Account a reopen is running for; its buttons are disabled. */
	pendingId?: string | null;
}) {
	const t = useTranslations("wealth");
	const locale = useLocale();

	if (accounts.length === 0) return null;

	return (
		<Collapsible>
			<CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-3 text-left">
				<span className="text-muted-foreground text-sm">
					{t("closedAccounts", { count: accounts.length })}
				</span>
				<span className="h-px flex-1 bg-border" />
				<ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
			</CollapsibleTrigger>
			<CollapsibleContent className="pt-3">
				<ul className="divide-y divide-border rounded-md border">
					{accounts.map((account) => (
						<li
							className="flex items-center gap-2 px-3 py-2 text-sm"
							key={account.id}
						>
							<div className="min-w-0 flex-1">
								<p className="truncate font-medium">{account.name}</p>
								<p className="text-muted-foreground text-xs">
									{t("closedOn", {
										date: new Date(account.closedAt).toLocaleDateString(locale, {
											year: "numeric",
											month: "short",
											day: "numeric",
										}),
									})}
								</p>
							</div>
							<Button
								disabled={pendingId === account.id}
								onClick={() => onReopen(account.id)}
								size="sm"
								variant="ghost"
							>
								{t("reopen")}
							</Button>
							<Button
								className="text-destructive hover:bg-destructive/10 hover:text-destructive"
								disabled={pendingId === account.id}
								onClick={() => onDeletePermanently(account)}
								size="sm"
								variant="ghost"
							>
								{t("deletePermanently")}
							</Button>
						</li>
					))}
				</ul>
			</CollapsibleContent>
		</Collapsible>
	);
}
