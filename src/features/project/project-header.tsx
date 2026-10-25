"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { ActionMenu } from "~/components/actions/action-menu";
import type { ProjectTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { BackButton } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { useProjectDates } from "~/components/rows/project-row";
import { FaceStack } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { PageTabs } from "~/components/ui/page-tabs";
import { ProjectCover } from "~/features/projects/project-cover";
import type { PageView, ProjectTab } from "./types";

/**
 * Title, the people as faces and one sub line (dates and currency), Add
 * expense as the one primary, the overflow from the project registry, and
 * the tabs (Expenses, Summary, People; solo projects have no People).
 */
export function ProjectHeader({
	view,
	tab,
	me,
	handlers,
}: {
	view: PageView;
	tab: ProjectTab;
	me: string;
	handlers: ActionHandlers<ProjectTarget>;
}) {
	const t = useTranslations("projectV2");
	const nav = useTranslations("shell.nav");
	const dates = useProjectDates();
	const { openNewExpense } = useExpenseModal();
	const archived = view.status === "ARCHIVED";
	const add = () =>
		openNewExpense({
			projectId: view.id,
			projectName: view.name,
			projectDefaultCurrency: view.primaryCurrency,
			isSolo: view.solo,
		});
	const span = view.firstExpense
		? dates({
				start: view.firstExpense,
				end: archived ? view.lastExpense : null,
			})
		: null;
	const sub = [view.solo ? t("solo") : null, span, view.primaryCurrency]
		.filter(Boolean)
		.join(" · ");
	const base = `/projects/${view.id}`;
	const tabs = [
		{ id: "expenses", href: base, label: t("tabs.expenses") },
		{ id: "summary", href: `${base}?tab=summary`, label: t("tabs.summary") },
		...(view.solo
			? []
			: [
					{ id: "people", href: `${base}?tab=people`, label: t("tabs.people") },
				]),
	];
	const target: ProjectTarget = {
		id: view.id,
		name: view.name,
		solo: view.solo,
		archived,
		owner: view.myRole === "ORGANIZER",
	};
	return (
		<PageHeader
			faces={
				view.solo ? undefined : (
					<FaceStack
						people={view.members.map((m) => ({
							id: m.id,
							name: m.name,
							imageUrl: m.imageUrl,
							isSelf: m.id === me,
						}))}
					/>
				)
			}
			lead={
				<>
					<BackButton href="/projects" label={nav("projects")} />
					{view.imageUrl ? (
						<span
							aria-hidden="true"
							className="rounded-ctl bg-raised flex size-10 shrink-0 overflow-hidden *:size-full"
						>
							<ProjectCover src={view.imageUrl} />
						</span>
					) : null}
				</>
			}
			overflow={
				<ActionMenu entity="project" handlers={handlers} target={target} />
			}
			primary={
				archived ? undefined : (
					// Phones add with the shell's floating Add (one Add per screen).
					<Button className="max-md:hidden" kind="primary" onClick={add}>
						<Plus aria-hidden="true" />
						{t("addExpense")}
					</Button>
				)
			}
			sub={sub}
			tabs={<PageTabs current={tab} items={tabs} />}
			title={view.name}
		/>
	);
}
