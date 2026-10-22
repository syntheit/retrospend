"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Balance } from "~/components/money/balance";
import { Money } from "~/components/money/money";
import { FaceStack } from "~/components/ui/avatar-face";
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

/**
 * ProjectRow: the cover is content (N41). A shared project shows your
 * balance and the faces; a solo one shows what it spent. A thin bar shows
 * the budget used when there is a budget.
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
	const end = project.balance ? (
		<Balance amount={project.balance} className={stacked} />
	) : project.spent ? (
		<>
			<Money value={project.spent} />
			<span className="text-fg-3 text-meta">{t("spent")}</span>
		</>
	) : null;
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
					{project.budgetUsed && (
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
