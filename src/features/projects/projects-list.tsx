"use client";

import { useTranslations } from "next-intl";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { ProjectTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { Section } from "~/components/layout/section";
import { ProjectRow } from "~/components/rows/project-row";
import { RowList } from "~/components/rows/row";
import type { ProjectVM } from "~/components/rows/types";
import { ProjectCover } from "./project-cover";
import { targetOf } from "./use-project-actions";
import { figureFor, type ListItem, lineIn } from "./view-model";

/**
 * The row's view model. A shared project ends with your balance in it (your
 * `project.member.balance` line in the project's currency; zero reads
 * Settled); a solo one, or a shared one with no expenses yet, with what it
 * spent (`project.total`).
 */
function toRow(p: ListItem, me: string): ProjectVM {
	const shared = !p.solo && p.expenseCount > 0;
	// No line in any currency means even: the kit's Balance reads zero as Settled.
	const balance = shared
		? (lineIn(p.myBalance, p.currency) ?? { minor: 0, currency: p.currency })
		: null;
	return {
		id: p.id,
		name: p.name,
		href: `/projects/${p.id}`,
		cover: <ProjectCover src={p.imageUrl} />,
		solo: p.solo,
		people: p.people,
		peopleCount: p.peopleCount,
		start: p.firstExpense,
		end: p.status === "ARCHIVED" ? p.lastExpense : null,
		balance,
		spent: balance ? undefined : (lineIn(p.total, p.currency) ?? undefined),
		figure: balance
			? figureFor("project.member.balance", p.id, me)
			: figureFor("project.total", p.id),
		budgetUsed: p.budget ? { basis: p.budget.used, over: p.budget.over } : null,
		// Desktop columns (projects.html), each in the project's currency.
		// Other currencies wait for a project-currency read (GAPS).
		columns: {
			total: lineIn(p.total, p.currency),
			totalFigure: figureFor("project.total", p.id),
			share: p.solo ? null : lineIn(p.myShare, p.currency),
			shareFigure: figureFor("project.member.share", p.id, me),
			budgetLeft: p.budget?.left ?? null,
		},
	};
}

function Rows({
	items,
	me,
	handlers,
	label,
}: {
	items: ListItem[];
	me: string;
	handlers: ActionHandlers<ProjectTarget>;
	label: string;
}) {
	return (
		<RowList label={label}>
			{items.map((p) => {
				const target = targetOf({
					...p,
					archived: p.status === "ARCHIVED",
					owner: p.myRole === "ORGANIZER",
				});
				return (
					<ActionArea
						entity="project"
						handlers={handlers}
						key={p.id}
						target={target}
					>
						<ProjectRow
							actions={
								<ActionMenu
									entity="project"
									handlers={handlers}
									target={target}
								/>
							}
							project={toRow(p, me)}
						/>
					</ActionArea>
				);
			})}
		</RowList>
	);
}

/** Active projects, then the past ones under their year. */
export function ProjectsList({
	active,
	years,
	me,
	handlers,
}: {
	active: ListItem[];
	years: { year: number; items: ListItem[] }[];
	me: string;
	handlers: ActionHandlers<ProjectTarget>;
}) {
	const t = useTranslations("projectsV2");
	return (
		<>
			{active.length > 0 && (
				<Section count={active.length} title={t("active")}>
					<Rows
						handlers={handlers}
						items={active}
						label={t("active")}
						me={me}
					/>
				</Section>
			)}
			{years.map((y) => (
				<Section count={y.items.length} key={y.year} title={String(y.year)}>
					<Rows
						handlers={handlers}
						items={y.items}
						label={t("pastIn", { year: y.year })}
						me={me}
					/>
				</Section>
			))}
		</>
	);
}
