"use client";

import { CloudOff, FolderPlus, SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "~/components/layout/page-header";
import { Toolbar } from "~/components/layout/toolbar";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { Input } from "~/components/ui/input";
import { Skeleton, SkeletonRows } from "~/components/ui/skeleton";
import { PageFrame } from "~/features/wealth/page-frame";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";
import { NewProjectSheet } from "./new-project-sheet";
import { ProjectsList } from "./projects-list";
import { useProjectActions } from "./use-project-actions";
import { groupProjects } from "./view-model";

/** "/" focuses the search unless the person is typing somewhere. */
function useSlashFocus(ref: React.RefObject<HTMLInputElement | null>) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const el = e.target as HTMLElement | null;
			const typing = el?.closest("input, textarea, [contenteditable=true]");
			if (e.key !== "/" || typing || e.metaKey || e.ctrlKey) return;
			e.preventDefault();
			ref.current?.focus();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [ref]);
}

/**
 * The Projects list (uiV2): header with New project, one search, then the
 * active projects and the past ones by year as ProjectRows (layout B, the
 * dense rows: TELLS #35 retired the hero and cover cards).
 */
export function ProjectsPage() {
	const t = useTranslations("projectsV2");
	const session = useSession();
	const list = api.project.listView.useQuery();
	const [query, setQuery] = useState("");
	const [creating, setCreating] = useState(false);
	const search = useRef<HTMLInputElement>(null);
	useSlashFocus(search);
	const items = list.data ?? [];
	const byId = useCallback(
		(id: string) => {
			const p = items.find((x) => x.id === id);
			return (
				p && {
					...p,
					archived: p.status === "ARCHIVED",
					owner: p.myRole === "ORGANIZER",
				}
			);
		},
		[items],
	);
	const handlers = useProjectActions(byId);
	const me = `user:${session.data?.user.id ?? ""}`;
	const groups = groupProjects(items, query);
	const none = groups.active.length === 0 && groups.years.length === 0;

	const newProject = (
		<Button kind="primary" onClick={() => setCreating(true)}>
			{t("newProject")}
		</Button>
	);

	return (
		<PageFrame label="projects">
			<PageHeader primary={newProject} title={t("title")} />
			{list.isPending ? (
				<div aria-busy="true">
					<Skeleton className="mb-4 w-60" shape="line" />
					<SkeletonRows count={6} />
				</div>
			) : list.isError ? (
				<Empty
					action={
						<Button kind="secondary" onClick={() => list.refetch()} size="sm">
							{t("unavailable.retry")}
						</Button>
					}
					hint={t("unavailable.hint")}
					icon={CloudOff}
					title={t("unavailable.title")}
				/>
			) : items.length === 0 ? (
				<Empty
					action={
						<Button
							kind="secondary"
							onClick={() => setCreating(true)}
							size="sm"
						>
							{t("newProject")}
						</Button>
					}
					hint={t("empty.hint")}
					icon={FolderPlus}
					title={t("empty.title")}
				/>
			) : (
				<>
					<Toolbar label={t("search")}>
						<Input
							aria-label={t("search")}
							className="h-ctl w-60 max-md:w-full"
							onChange={(e) => setQuery(e.target.value)}
							placeholder={t("search")}
							ref={search}
							type="search"
							value={query}
						/>
					</Toolbar>
					{none ? (
						<Empty
							action={
								<Button kind="secondary" onClick={() => setQuery("")} size="sm">
									{t("noMatch.clear")}
								</Button>
							}
							hint={t("noMatch.hint")}
							icon={SearchX}
							title={t("noMatch.title")}
						/>
					) : (
						<ProjectsList
							active={groups.active}
							handlers={handlers}
							me={me}
							years={groups.years}
						/>
					)}
				</>
			)}
			{creating ? <NewProjectSheet onOpenChange={setCreating} /> : null}
		</PageFrame>
	);
}
