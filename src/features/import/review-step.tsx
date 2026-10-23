"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { FileX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { TableSkeleton } from "~/components/table/table-skeleton";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { Notice } from "~/components/ui/notice";
import { SkeletonRows } from "~/components/ui/skeleton";
import { useEntryCatalog } from "~/features/entry/shared-ui";
import { useIsMobile } from "~/hooks/use-mobile";
import type { ImportSummary } from "~/server/services/import/commit.mutation";
import type { ImportKind } from "~/server/services/import/rows";
import { api } from "~/trpc/react";
import {
	type Choice,
	type Choices,
	commitRows,
	countsOf,
	importable,
	initialChoices,
	isKept,
	unmatchedNames,
	withAllKept,
	withChoice,
} from "./choices";
import { ImportSheet } from "./import-sheet";
import { MatchSheet } from "./match-sheet";
import { ReviewCards } from "./review-cards";
import {
	CountsLine,
	ImportBar,
	ReviewNotice,
	ReviewToolbar,
	type ReviewView,
} from "./review-parts";
import { ReviewList, ReviewTable } from "./review-table";
import type { CategoryPick } from "./row-controls";
import { useMatch } from "./use-match";

/**
 * Review (import.html step 3): the file's rows as a table on desktop, cards
 * or a list on phones; one state for all three (keep, kind, category). Every
 * number comes from importQueue.review; Import opens the sheet that previews
 * the commit.
 */
export function ReviewStep({
	jobId,
	onBack,
	onReread,
	onImported,
}: {
	jobId: string;
	onBack: () => void;
	onReread: (() => void) | null;
	onImported: (summary: ImportSummary) => void;
}) {
	const t = useTranslations("importPage.review");
	const phone = useIsMobile();
	const [currency, setCurrency] = useState<string | null>(null);
	const review = api.importQueue.review.useQuery(
		{ jobId, currency },
		{ placeholderData: keepPreviousData },
	);
	const catalog = useEntryCatalog();
	const [choices, setChoices] = useState<Choices>({});
	const [chosenView, setView] = useState<ReviewView | null>(null);
	const [showDups, setShowDups] = useState(false);
	const [dismissed, setDismissed] = useState(false);
	const [sheet, setSheet] = useState<"match" | "import" | null>(null);
	const data = review.data;

	useEffect(() => {
		if (data) setChoices((c) => initialChoices(data.rows, c));
	}, [data]);

	const pick: CategoryPick = useMemo(
		() => ({
			categories: catalog.data?.categories ?? [],
			recentIds: catalog.data?.recentCategoryIds ?? [],
		}),
		[catalog.data],
	);
	const match = useMatch({ data, choices, setChoices, pick });
	// Phones: Cards (the default) or List; desktop: Table (the default) or Cards.
	const view: ReviewView = phone
		? chosenView === "list" || chosenView === "table"
			? "list"
			: "cards"
		: chosenView === "cards"
			? "cards"
			: "table";

	if (review.isPending)
		return phone ? <SkeletonRows count={6} /> : <TableSkeleton rows={8} />;
	if (review.isError || !data)
		return (
			<Notice
				action={
					<Button
						kind="secondary"
						onClick={() => void review.refetch()}
						size="sm"
					>
						{t("retry")}
					</Button>
				}
				tone="danger"
			>
				{t("loadError")}
				{review.error ? (
					<span className="text-fg-3 text-small block">
						{review.error.message}
					</span>
				) : null}
			</Notice>
		);
	if (data.rows.length === 0)
		return (
			<Empty
				action={
					<Button kind="secondary" onClick={onBack} size="sm">
						{t("back")}
					</Button>
				}
				icon={FileX}
				title={t("empty")}
			/>
		);

	const counts = countsOf(data.rows, choices);
	const unmatched = unmatchedNames(data, choices);
	const shown = data.rows.filter((r) => showDups || !r.duplicate);
	const kinds = new Map(pick.categories.map((c) => [c.id, c.kind]));
	const onChoice = (index: number, patch: Partial<Choice>) =>
		setChoices((c) => withChoice(c, index, patch));
	const onKind = (index: number, kind: ImportKind) =>
		setChoices((c) => {
			const id = c[index]?.categoryId;
			const fits = !id || (kinds.get(id) === "INCOME") === (kind === "income");
			return withChoice(c, index, fits ? { kind } : { kind, categoryId: null });
		});
	const body = { rows: shown, choices, pick, onChoice, onKind };
	const importable_ = data.rows.filter(importable);
	const bar = (
		<ImportBar
			dups={counts.duplicates}
			kept={counts.kept}
			onBack={onBack}
			onImport={() => setSheet("import")}
		/>
	);
	return (
		<div data-testid="import-review">
			<div className="mb-2 flex flex-wrap items-center gap-2">
				<CountsLine counts={counts} review={data} />
			</div>
			<ReviewNotice
				dismissed={dismissed}
				onDismiss={() => setDismissed(true)}
				onMatch={() => setSheet("match")}
				phone={phone}
				unmatched={unmatched}
				unreadable={data.counts.unreadable}
			/>
			{view === "cards" ? null : (
				<ReviewToolbar
					currency={currency}
					dups={counts.duplicates}
					onCurrency={setCurrency}
					onReread={onReread}
					onShowDups={setShowDups}
					onView={setView}
					phone={phone}
					review={data}
					showDups={showDups}
					view={view}
				/>
			)}
			{view === "cards" ? (
				<ReviewCards
					{...body}
					fileName={data.fileName}
					footer={bar}
					rows={data.rows}
				/>
			) : view === "list" ? (
				<ReviewList {...body} />
			) : (
				<ReviewTable
					{...body}
					allKept={
						importable_.length > 0 &&
						importable_.every((r) => isKept(r, choices))
					}
					onAll={(keep) => setChoices((c) => withAllKept(data.rows, c, keep))}
				/>
			)}
			{view === "cards" ? null : bar}
			<MatchSheet
				onApply={match.apply}
				onOpenChange={(o) => setSheet(o ? "match" : null)}
				open={sheet === "match"}
				pick={pick}
				unmatched={unmatched}
			/>
			<ImportSheet
				count={counts.kept}
				fileName={data.fileName}
				input={{ jobId, currency, rows: commitRows(data.rows, choices) }}
				onImported={(s) => {
					setSheet(null);
					onImported(s);
				}}
				onOpenChange={(o) => setSheet(o ? "import" : null)}
				open={sheet === "import"}
			/>
		</div>
	);
}
