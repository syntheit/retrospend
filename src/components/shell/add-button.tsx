"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Tip } from "~/components/ui/tooltip";
import { cn } from "~/lib/cn";
import { ADD_ACTIONS, type AddEntry } from "~/lib/nav";
import { MENU_CONTENT, MENU_HINT, MENU_ITEM } from "./menu-styles";
import { useShellActions } from "./shell-context";

function AddMenuItem({ entry }: { entry: AddEntry }) {
	const t = useTranslations("shell.add");
	const { add } = useShellActions();
	const Icon = entry.icon;
	const item = (
		<DropdownMenuItem
			aria-disabled={entry.ready ? undefined : true}
			className={cn(MENU_ITEM, !entry.ready && "opacity-45 focus:bg-transparent")}
			onSelect={(e) => {
				// A sheet that does not exist yet keeps the menu open; the tip says why.
				if (!entry.ready) e.preventDefault();
				else add(entry.id);
			}}
		>
			<Icon aria-hidden="true" className="size-4" />
			{t(entry.id)}
			<DropdownMenuShortcut className={MENU_HINT}>
				{entry.key.toUpperCase()}
			</DropdownMenuShortcut>
		</DropdownMenuItem>
	);
	return entry.ready ? (
		item
	) : (
		<Tip content={t("comingSoon")} side="right">
			{item}
		</Tip>
	);
}

/**
 * The global Add (PLAN §14, option B): the split button "Add expense ▾".
 * The main part adds an expense (N); the menu holds Add income (I) and
 * Transfer (T), shown but disabled until their sheets exist (4G).
 */
export function AddSplitButton({ className }: { className?: string }) {
	const t = useTranslations("shell.add");
	const { add } = useShellActions();
	return (
		<div
			aria-label={t("group")}
			className={cn("flex w-full gap-0.5", className)}
			role="group"
		>
			<Button
				className="min-w-0 flex-1 rounded-r-none"
				kind="primary"
				onClick={() => add("expense")}
			>
				<Plus aria-hidden="true" />
				<span className="truncate">{t("expense")}</span>
			</Button>
			<DropdownMenu>
				<Tip content={t("more")}>
					<DropdownMenuTrigger asChild>
						<Button
							aria-label={t("more")}
							className="w-9 rounded-l-none"
							icon
							kind="primary"
						>
							<ChevronDown aria-hidden="true" />
						</Button>
					</DropdownMenuTrigger>
				</Tip>
				<DropdownMenuContent align="end" className={MENU_CONTENT}>
					{ADD_ACTIONS.map((entry) => (
						<AddMenuItem entry={entry} key={entry.id} />
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
