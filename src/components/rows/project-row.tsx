"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Balance } from "~/components/money/balance";
import { signOf } from "~/components/money/format";
import { Money } from "~/components/money/money";
import { FaceStack } from "~/components/ui/avatar-face";
import { cn } from "~/lib/cn";
import { useRowDates } from "./dates";
import { Row, RowBar, type RowPassThrough, RowSub, useRowVariant } from "./row";
import type { ProjectVM } from "./types";

/** "Oct 9 to Oct 18", "Since Aug 12" or "Open". */
export function useProjectDates() {
	const t = useTranslations("rows.project");
	const { short } = useRowDates();
	return (p: Pick<ProjectVM, "start" | "end">) => {
		if (p.start && p.end)
			return t("range", { start: short(p.start), end: short(p.end) });
		if (p.start) return t("since", { start: short(p.start) });
		return t("open");
	};
}

/** The project cover in the row's lead slot; a flat tile until it has one. */
function CoverSlot({ cover }: { cover?: ReactNode }) {
	return (
		<span
			aria-hidden="true"
			className="rounded-ctl bg-raised flex size-12 shrink-0 overflow-hidden *:size-full"
		>
			{cover}
		</span>
	);
}

/** Your balance, or what a solo or not yet shared project spent. */
function EndFigure({
	project,
	stacked,
}: {
	project: ProjectVM;
	stacked?: string;
}) {
	const t = useTranslations("rows.project");
	if (project.balance)
		return (
			<Balance
				amount={project.balance}
				className={stacked}
				figure={project.figure}
			/>
		);
	if (!project.spent) return null;
	return (
		<span className="flex flex-col items-end">
			<Money figure={project.figure} value={project.spent} />
			<span className="text-fg-3 text-meta">{t("spent")}</span>
		</span>
	);
}

/**
 * The desktop columns (projects.html): the group total with your share
 * under it (a solo project: "spent"), the budget bar with what is left,
 * then your balance ("Just you" alone). Fixed widths keep each column on
 * one edge down the list (R27).
 */
function Columns({
	project,
	columns,
}: {
	project: ProjectVM;
	columns: NonNullable<ProjectVM["columns"]>;
}) {
	const t = useTranslations("rows.project");
	const left = columns.budgetLeft;
	const over = left != null && signOf(left) < 0;
	return (
		<span className="flex items-center gap-4">
			<span className="text-small text-fg-2 flex w-38 flex-col items-end">
				{columns.total && (
					<Money
						className="text-fg font-semibold"
						figure={columns.totalFigure}
						value={columns.total}
					/>
				)}
				<span className="text-fg-3 text-meta whitespace-nowrap">
					{project.solo || !columns.share ? (
						t("spent")
					) : (
						<>
							{t("yourShare")}{" "}
							<Money figure={columns.shareFigure} value={columns.share} />
						</>
					)}
				</span>
			</span>
			<span className="text-fg-3 text-meta flex w-40 flex-col items-stretch text-left">
				{project.budgetUsed && (
					<>
						<RowBar
							basis={project.budgetUsed.basis}
							label={t("budgetUsed")}
							over={project.budgetUsed.over}
						/>
						{left && (
							<span className="mt-1 whitespace-nowrap">
								{t.rich(over ? "over" : "left", {
									amount: () => <Money sign="never" value={left} />,
								})}
							</span>
						)}
					</>
				)}
			</span>
			<span className="flex w-48 justify-end">
				{project.solo ? (
					<span className="text-fg-3 text-meta">{t("justYou")}</span>
				) : (
					<EndFigure project={project} />
				)}
			</span>
		</span>
	);
}

/**
 * ProjectRow: the cover is content (N41). A shared project shows your
 * balance and the faces; a solo one shows what it spent. A thin bar shows
 * the budget used when there is a budget. With `columns`, desktop lists
 * add the total, your share and the budget left (projects.html); phones
 * keep the one end figure and no budget.
 */
export function ProjectRow({
	project,
	actions,
	...rest
}: {
	project: ProjectVM;
	actions?: ReactNode;
} & RowPassThrough) {
	const t = useTranslations("rows.project");
	const dates = useProjectDates()(project);
	const variant = useRowVariant();
	const stacked =
		variant === "group"
			? "flex flex-col items-end"
			: variant === "auto"
				? "max-md:flex max-md:flex-col max-md:items-end"
				: undefined;
	const wide =
		variant === "flat" ? "" : variant === "group" ? "hidden" : "max-md:hidden";
	const narrow =
		variant === "flat" ? "hidden" : variant === "group" ? "" : "md:hidden";
	const sub =
		project.solo || project.people.length === 0 ? (
			<RowSub
				parts={[
					project.solo
						? t("solo")
						: t("people", { count: project.peopleCount }),
					dates,
				]}
			/>
		) : (
			<RowSub
				parts={[
					<FaceStack
						key="f"
						on={variant === "group" ? "surface" : "bg"}
						people={project.people}
					/>,
					dates,
				]}
			/>
		);
	const cols = project.columns;
	const end = cols ? (
		<>
			<span className={wide}>
				<Columns columns={cols} project={project} />
			</span>
			<span className={cn("flex flex-col items-end", narrow)}>
				<EndFigure project={project} stacked={stacked} />
			</span>
		</>
	) : (
		<EndFigure project={project} stacked={stacked} />
	);
	return (
		<Row
			{...rest}
			actions={actions}
			end={end}
			lead={<CoverSlot cover={project.cover} />}
			open={{ href: project.href }}
			sub={
				<>
					{sub}
					{project.budgetUsed && !cols && (
						<RowBar
							basis={project.budgetUsed.basis}
							label={t("budgetUsed")}
							over={project.budgetUsed.over}
						/>
					)}
				</>
			}
			title={project.name}
		/>
	);
}
