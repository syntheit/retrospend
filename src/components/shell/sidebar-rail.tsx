"use client";

import { PanelLeftOpen, Plus, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Tip } from "~/components/ui/tooltip";
import { cn } from "~/lib/cn";
import {
	DESTINATIONS,
	type NavBadges,
	type NavId,
	projectHref,
	TOOLS,
} from "~/lib/nav";
import { RailLink } from "./nav-link";
import { useShellActions } from "./shell-context";

/**
 * The sidebar collapsed to a rail (T2, tablet widths): Add and search on
 * top, each destination as its icon over its label (the selected one is one
 * lozenge around both), pinned projects, then the expand toggle and account.
 */
export function SidebarRail({
	pinned,
	pinnedCurrentId,
	current,
	badges,
	bell,
	account,
	className,
	onToggleRail,
}: {
	pinned: { id: string; name: string; lead: ReactNode }[];
	pinnedCurrentId: string | undefined;
	current: NavId | null;
	badges?: NavBadges;
	bell: ReactNode;
	account: ReactNode;
	className?: string;
	onToggleRail?: () => void;
}) {
	const t = useTranslations("shell");
	const tn = useTranslations("shell.nav");
	const { openPalette, add } = useShellActions();
	return (
		<aside
			aria-label={t("sidebar.label")}
			className={cn(
				"border-line bg-bg flex w-20 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r px-1 pt-4 pb-3",
				className,
			)}
			data-rail=""
		>
			<span aria-hidden="true" className="rounded-ctl bg-brand size-5" />
			<Tip content={t("add.expense")}>
				<Button
					aria-label={t("add.expense")}
					className="my-2"
					icon
					kind="primary"
					onClick={() => add("expense")}
				>
					<Plus aria-hidden="true" />
				</Button>
			</Tip>
			<Tip content={t("palette.trigger")}>
				<Button
					aria-label={t("palette.trigger")}
					className="text-fg-3"
					icon
					kind="ghost"
					onClick={openPalette}
				>
					<Search aria-hidden="true" />
				</Button>
			</Tip>
			{bell}
			<nav
				aria-label={t("sidebar.destinations")}
				className="mt-2 flex w-full flex-col gap-0.5"
			>
				{[...DESTINATIONS, ...TOOLS].map((entry) => {
					const Icon = entry.icon;
					return (
						<RailLink
							badge={badges?.[entry.id as keyof NavBadges]}
							current={current === entry.id}
							href={entry.href}
							key={entry.id}
							label={tn(entry.id)}
							lead={<Icon aria-hidden="true" className="size-4" />}
						/>
					);
				})}
				{pinned.map((p) => (
					<RailLink
						current={p.id === pinnedCurrentId}
						href={projectHref(p.id)}
						key={p.id}
						label={p.name}
						lead={p.lead}
					/>
				))}
			</nav>
			<div className="flex-1" />
			{onToggleRail ? (
				<Tip content={t("sidebar.expand")}>
					<Button
						aria-label={t("sidebar.expand")}
						className="text-fg-3"
						icon
						kind="ghost"
						onClick={onToggleRail}
					>
						<PanelLeftOpen aria-hidden="true" />
					</Button>
				</Tip>
			) : null}
			{account}
		</aside>
	);
}
