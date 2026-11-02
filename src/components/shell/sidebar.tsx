"use client";

import { PanelLeftClose, PanelLeftOpen, Plus, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useMemo } from "react";
import { ActionArea } from "~/components/actions/action-menu";
import type { ProjectTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { ProjectVisual } from "~/components/project/project-visual";
import { Button } from "~/components/ui/button";
import { Tip } from "~/components/ui/tooltip";
import { useProjectActions } from "~/features/projects/use-project-actions";
import { cn } from "~/lib/cn";
import {
	currentNav,
	DESTINATIONS,
	type NavBadges,
	type NavEntry,
	pinnedProjects,
	projectHref,
	TOOLS,
} from "~/lib/nav";
import { api } from "~/trpc/react";
import { AccountMenu } from "./account-menu";
import { AddSplitButton } from "./add-button";
import { RailLink, SidebarLink } from "./nav-link";
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
		<h2 className="text-fg-3 text-meta px-3 pt-4 pb-1 font-medium tracking-wider uppercase">
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
				const Icon = entry.icon;
				return (
					<SidebarLink
						badge={badges?.[entry.id as keyof NavBadges]}
						current={current === entry.id}
						href={entry.href}
						key={entry.id}
						label={t(entry.id)}
						lead={<Icon aria-hidden="true" className="size-4" />}
					/>
				);
			})}
		</nav>
	);
}

/** A pinned project as the sidebar draws it; with a target it has a context menu. */
export type PinnedItem = {
	id: string;
	name: string;
	lead: ReactNode;
	target?: ProjectTarget;
};

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
	projectActions,
	className,
	rail = false,
	onToggleRail,
}: {
	pathname: string;
	pinned: PinnedItem[];
	badges?: NavBadges;
	bell: ReactNode;
	account: ReactNode;
	/** What a pinned row's context menu can do (right-click, the menu key). */
	projectActions?: ActionHandlers<ProjectTarget>;
	className?: string;
	/** Collapsed to a rail: icon over label, Add and the toggle on top. */
	rail?: boolean;
	onToggleRail?: () => void;
}) {
	const t = useTranslations("shell");
	const tn = useTranslations("shell.nav");
	const { openPalette, add } = useShellActions();
	const pinnedCurrent = pinned.find((p) => pathname === projectHref(p.id));
	// One item is the current page: a pinned project wins over Projects.
	const current = pinnedCurrent ? null : currentNav(pathname);
	if (rail)
		return (
			<aside
				aria-label={t("sidebar.label")}
				className={cn(
					"border-line bg-bg flex w-20 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r px-2 pt-4 pb-3",
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
							current={p.id === pinnedCurrent?.id}
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
	return (
		<aside
			aria-label={t("sidebar.label")}
			className={cn(
				"border-line bg-bg flex w-58 shrink-0 flex-col gap-1 overflow-y-auto border-r px-3 pt-4 pb-3",
				className,
			)}
		>
			<div className="flex items-center gap-2 px-2 pb-2">
				<span aria-hidden="true" className="rounded-ctl bg-brand size-5" />
				<span className="text-fg text-section flex-1 font-semibold">
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
						{pinned.map((p) => {
							const link = (
								<SidebarLink
									current={p.id === pinnedCurrent?.id}
									href={projectHref(p.id)}
									key={p.id}
									label={p.name}
									lead={p.lead}
								/>
							);
							return p.target && projectActions ? (
								<ActionArea
									entity="project"
									handlers={projectActions}
									key={p.id}
									target={p.target}
								>
									{link}
								</ActionArea>
							) : (
								<span className="contents" key={p.id}>
									{link}
								</span>
							);
						})}
					</nav>
				</>
			)}
			<div className="flex-1" />
			{onToggleRail ? (
				<Button
					className="text-fg-2 justify-start"
					kind="ghost"
					onClick={onToggleRail}
				>
					<PanelLeftClose aria-hidden="true" />
					{t("sidebar.collapse")}
				</Button>
			) : null}
			{account}
		</aside>
	);
}

/** What a pinned project's menu needs from `project.list`; pinned projects are active. */
function sidebarTarget(p: {
	id: string;
	name: string;
	myRole: string | null;
	_count: { participants: number };
}): ProjectTarget & { archived: boolean; owner: boolean; editor: boolean } {
	return {
		id: p.id,
		name: p.name,
		solo: p._count.participants <= 1,
		archived: false,
		owner: p.myRole === "ORGANIZER",
		editor: p.myRole === "ORGANIZER" || p.myRole === "EDITOR",
	};
}

/** The sidebar on live data: pinned projects, the notifications bell, the account menu. */
export function ShellSidebar({
	badges,
	className,
	rail,
	onToggleRail,
}: {
	badges?: NavBadges;
	className?: string;
	rail?: boolean;
	onToggleRail?: () => void;
}) {
	const pathname = usePathname();
	const router = useRouter();
	const projects = usePinnedProjects();
	const byId = useCallback(
		(id: string) => {
			const p = projects.find((x) => x.id === id);
			return p && { ...sidebarTarget(p), currency: p.primaryCurrency };
		},
		[projects],
	);
	const base = useProjectActions(byId);
	// Share and Settings are sheets of the project page: open the page with that sheet.
	const projectActions = useMemo<ActionHandlers<ProjectTarget>>(
		() => ({
			open: (x) => router.push(projectHref(x.id)),
			addExpense: base.addExpense,
			share: (x) => router.push(`${projectHref(x.id)}?sheet=share`),
			settings: (x) => router.push(`${projectHref(x.id)}?sheet=settings`),
			archive: base.archive,
		}),
		[base, router],
	);
	const pinned = projects.map((p) => ({
		id: p.id,
		name: p.name,
		target: sidebarTarget(p),
		lead: (
			<ProjectVisual
				className="rounded-ctl size-4.5 shrink-0"
				imagePath={p.imagePath}
				projectName={p.name}
				size="xs"
			/>
		),
	}));
	return (
		<SidebarView
			account={<AccountMenu compact={rail} />}
			badges={badges}
			bell={<NotificationsButton />}
			className={className}
			onToggleRail={onToggleRail}
			pathname={pathname}
			pinned={pinned}
			projectActions={projectActions}
			rail={rail}
		/>
	);
}
