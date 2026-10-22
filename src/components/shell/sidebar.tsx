"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ProjectVisual } from "~/components/project/project-visual";
import { Button } from "~/components/ui/button";
import { Tip } from "~/components/ui/tooltip";
import { cn } from "~/lib/cn";
import {
	currentNav,
	DESTINATIONS,
	hrefOf,
	type NavBadges,
	type NavEntry,
	pinnedProjects,
	projectHref,
	TOOLS,
} from "~/lib/nav";
import { api } from "~/trpc/react";
import { AccountMenu } from "./account-menu";
import { AddSplitButton } from "./add-button";
import { SidebarLink } from "./nav-link";
import { NotificationsButton } from "./notifications";
import { useShellActions } from "./shell-context";

/** Pinned projects for the sidebar; the same query Projects reads, so it is cached once. */
export function usePinnedProjects() {
	const { data } = api.project.list.useQuery(
		{ status: "ACTIVE" },
		{ staleTime: 60_000 },
	);
	return pinnedProjects(data ?? []);
}

function GroupLabel({ children }: { children: string }) {
	return (
		<h2 className="px-3 pt-4 pb-1 font-medium text-fg-3 text-meta uppercase tracking-wider">
			{children}
		</h2>
	);
}

function EntryLinks({
	entries,
	current,
	badges,
	label,
}: {
	entries: readonly NavEntry[];
	current: string | null;
	badges?: NavBadges;
	label: string;
}) {
	const t = useTranslations("shell.nav");
	return (
		<nav aria-label={label} className="flex flex-col gap-0.5">
			{entries.map((entry) => {
				const href = hrefOf(entry);
				if (!href) return null;
				const Icon = entry.icon;
				return (
					<SidebarLink
						badge={badges?.[entry.id as keyof NavBadges]}
						current={current === entry.id}
						href={href}
						key={entry.id}
						label={t(entry.id)}
						lead={<Icon aria-hidden="true" className="size-4" />}
					/>
				);
			})}
		</nav>
	);
}

/** A pinned project as the sidebar draws it. */
export type PinnedItem = { id: string; name: string; lead: ReactNode };

/**
 * The desktop and tablet sidebar (components.html, shell): the logo row with
 * search and notifications, the split Add, the six destinations, Tools,
 * pinned projects and the account button. Always shown, in the page color.
 * The view takes its data so the gallery can draw it on fixtures.
 */
export function SidebarView({
	pathname,
	pinned,
	badges,
	bell,
	account,
	className,
}: {
	pathname: string;
	pinned: PinnedItem[];
	badges?: NavBadges;
	bell: ReactNode;
	account: ReactNode;
	className?: string;
}) {
	const t = useTranslations("shell");
	const { openPalette } = useShellActions();
	const pinnedCurrent = pinned.find((p) => pathname === projectHref(p.id));
	// One item is the current page: a pinned project wins over Projects.
	const current = pinnedCurrent ? null : currentNav(pathname);
	return (
		<aside
			aria-label={t("sidebar.label")}
			className={cn(
				"flex w-58 shrink-0 flex-col gap-1 overflow-y-auto border-line border-r bg-bg px-3 pt-4 pb-3",
				className,
			)}
		>
			<div className="flex items-center gap-2 px-2 pb-2">
				<span aria-hidden="true" className="size-5 rounded-ctl bg-brand" />
				<span className="flex-1 font-semibold text-fg text-section">
					{t("brand")}
				</span>
				<Tip content={t("palette.trigger")}>
					<Button
						aria-label={t("palette.trigger")}
						className="text-fg-3"
						icon
						kind="ghost"
						onClick={openPalette}
						size="sm"
					>
						<Search aria-hidden="true" />
					</Button>
				</Tip>
				{bell}
			</div>
			<AddSplitButton className="mb-1" />
			<EntryLinks
				badges={badges}
				current={current}
				entries={DESTINATIONS}
				label={t("sidebar.destinations")}
			/>
			<GroupLabel>{t("sidebar.tools")}</GroupLabel>
			<EntryLinks
				current={current}
				entries={TOOLS}
				label={t("sidebar.tools")}
			/>
			{pinned.length > 0 && (
				<>
					<GroupLabel>{t("sidebar.pinned")}</GroupLabel>
					<nav
						aria-label={t("sidebar.pinnedLabel")}
						className="flex flex-col gap-0.5"
					>
						{pinned.map((p) => (
							<SidebarLink
								current={p.id === pinnedCurrent?.id}
								href={projectHref(p.id)}
								key={p.id}
								label={p.name}
								lead={p.lead}
							/>
						))}
					</nav>
				</>
			)}
			<div className="flex-1" />
			{account}
		</aside>
	);
}

/** The sidebar on live data: pinned projects, the notifications bell, the account menu. */
export function ShellSidebar({
	badges,
	className,
}: {
	badges?: NavBadges;
	className?: string;
}) {
	const pathname = usePathname();
	const pinned = usePinnedProjects().map((p) => ({
		id: p.id,
		name: p.name,
		lead: (
			<ProjectVisual
				className="size-4.5 shrink-0 rounded-ctl"
				imagePath={p.imagePath}
				projectName={p.name}
				size="xs"
			/>
		),
	}));
	return (
		<SidebarView
			account={<AccountMenu />}
			badges={badges}
			bell={<NotificationsButton />}
			className={className}
			pathname={pathname}
			pinned={pinned}
		/>
	);
}
