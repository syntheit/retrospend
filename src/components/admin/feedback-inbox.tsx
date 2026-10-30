"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Toolbar } from "~/components/layout/toolbar";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { Segmented } from "~/components/ui/segmented";
import { api } from "~/trpc/react";
import { ErrorReportList } from "./error-report-list";
import { FeedbackList, type Filter } from "./feedback-list";

type View = "feedback" | "errors";
const FILTERS: Filter[] = ["all", "unread", "read", "archived"];

/**
 * The admin inbox for what the apps send: feedback (with its screenshot and
 * the errors the person attached) and the error reports phones sent on their
 * own. Newest first. A row opens a Sheet to read, mark read, archive, note or
 * delete. Screenshots load from an admin-only route.
 */
export function FeedbackInbox() {
	const t = useTranslations("feedbackInbox");
	const [view, setView] = useState<View>("feedback");
	const [filter, setFilter] = useState<Filter>("unread");
	return (
		<div>
			<Toolbar
				end={
					<Segmented
						label={t("viewLabel")}
						onChange={setView}
						options={[
							{ value: "feedback", label: t("view.feedback") },
							{ value: "errors", label: t("view.errors") },
						]}
						value={view}
					/>
				}
				label={t("filterLabel")}
			>
				{view === "feedback" ? (
					<StatusChips filter={filter} setFilter={setFilter} />
				) : null}
			</Toolbar>
			{view === "feedback" ? (
				<FeedbackList filter={filter} />
			) : (
				<ErrorReportList />
			)}
		</div>
	);
}

function StatusChips({
	filter,
	setFilter,
}: {
	filter: Filter;
	setFilter: (f: Filter) => void;
}) {
	const t = useTranslations("feedbackInbox");
	const { data } = api.feedback.list.useQuery({ limit: 1 });
	const counts = data?.counts;
	return (
		<FilterChips label={t("filterLabel")}>
			{FILTERS.map((id) => (
				<FilterChip
					key={id}
					onClick={() => setFilter(id)}
					selected={filter === id}
				>
					{t(`status.${id}`)}
					{counts ? (
						<span className="text-fg-3 tabular-nums">
							{id === "all" ? counts.total : counts[id]}
						</span>
					) : null}
				</FilterChip>
			))}
		</FilterChips>
	);
}
