"use client";

import { CloudOff } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "~/components/layout/page-header";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { Skeleton, SkeletonRows } from "~/components/ui/skeleton";
import { PageFrame } from "~/features/wealth/page-frame";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";
import { ExpensesPane } from "./expenses-pane";
import { PeoplePane } from "./people-pane";
import { ProjectHeader } from "./project-header";
import { ProjectHero } from "./project-hero";
import { ProjectSheets, type SheetState } from "./project-sheets";
import { SummaryPane } from "./summary-pane";
import { tabOf } from "./types";
import { useProjectPageActions } from "./use-project-page-actions";

/**
 * The expense sheet (today's modal) refreshes `project.listExpenses` and
 * `project.detail` after a save. This page reads `project.pageView`, so it
 * watches a one-row listExpenses query and reads the page again when that
 * query is refreshed.
 */
function useRefreshAfterExpenseSave(id: string) {
	const utils = api.useUtils();
	const watch = api.project.listExpenses.useQuery({
		projectId: id,
		page: 1,
		limit: 1,
	});
	const seen = useRef<number | null>(null);
	useEffect(() => {
		if (!watch.dataUpdatedAt) return;
		if (seen.current !== null && seen.current !== watch.dataUpdatedAt) {
			void utils.project.pageView.invalidate({ id });
			void utils.project.summary.invalidate({ projectId: id });
		}
		seen.current = watch.dataUpdatedAt;
	}, [watch.dataUpdatedAt, utils, id]);
}

/** What the link asked to open: ?settle=all, ?add=person. */
function initialSheet(params: URLSearchParams): SheetState {
	if (params.get("settle") === "all") return { kind: "settleAll" };
	if (params.get("add") === "person") return { kind: "addPerson" };
	return null;
}

export function ProjectScreen({ id }: { id: string }) {
	const t = useTranslations("projectV2");
	const params = useSearchParams();
	const session = useSession();
	const view = api.project.pageView.useQuery({ id });
	const summary = api.project.summary.useQuery({ projectId: id });
	const [sheet, setSheet] = useState<SheetState>(() => initialSheet(params));
	useRefreshAfterExpenseSave(id);
	const handlers = useProjectPageActions(view.data, setSheet);
	const me = `user:${session.data?.user.id ?? ""}`;

	if (view.isPending)
		return (
			<PageFrame label="project">
				<div aria-busy="true" className="flex flex-col gap-2">
					<Skeleton className="w-64" shape="line" />
					<Skeleton className="w-40" shape="line" />
					<Skeleton className="rounded-chip mt-6 h-8 w-56" shape="line" />
				</div>
				<SkeletonRows className="mt-8" count={8} />
			</PageFrame>
		);
	if (view.isError || !view.data)
		return (
			<PageFrame label="project">
				<PageHeader title={t("unavailable.title")} />
				<Empty
					action={
						<Button kind="secondary" onClick={() => view.refetch()} size="sm">
							{t("unavailable.retry")}
						</Button>
					}
					hint={t("unavailable.hint")}
					icon={CloudOff}
					title={t("unavailable.title")}
				/>
			</PageFrame>
		);

	const v = view.data;
	const tab = tabOf(params.get("tab"), v.solo);
	return (
		<PageFrame label="project">
			<ProjectHeader handlers={handlers} me={me} tab={tab} view={v} />
			<ProjectHero me={me} view={v} />
			{tab === "expenses" ? <ExpensesPane me={me} view={v} /> : null}
			{tab === "summary" ? (
				<SummaryPane
					me={me}
					onSettleAll={() => setSheet({ kind: "settleAll" })}
					summary={summary.data}
					view={v}
				/>
			) : null}
			{tab === "people" ? (
				<PeoplePane
					onAdd={() => setSheet({ kind: "addPerson" })}
					onSettings={() => setSheet({ kind: "settings" })}
					view={v}
				/>
			) : null}
			<ProjectSheets onClose={() => setSheet(null)} sheet={sheet} view={v} />
		</PageFrame>
	);
}
