"use client";

import { useTranslations } from "next-intl";
import { useRowDates } from "~/components/rows/dates";
import { Row, RowList } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { StatusDot } from "~/components/ui/status-dot";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/cn";
import type { ImportKind } from "~/server/services/import/rows";
import {
	type Choice,
	type Choices,
	importable,
	isKept,
	type ReviewRow,
} from "./choices";
import {
	CategoryCell,
	type CategoryPick,
	KindCell,
	RowMoney,
} from "./row-controls";

export interface ReviewBodyProps {
	rows: readonly ReviewRow[];
	choices: Choices;
	pick: CategoryPick;
	onChoice: (index: number, patch: Partial<Choice>) => void;
	onKind: (index: number, kind: ImportKind) => void;
}

/**
 * A likely match (queue-import-dupes.md): an Activity row with the same
 * amount within 3 days. The row stays in; Skip leaves it out in one tap.
 */
export function PossibleFlag({
	r,
	kept,
	onSkip,
}: {
	r: ReviewRow;
	kept: boolean;
	onSkip: () => void;
}) {
	const t = useTranslations("importPage.review");
	const { short } = useRowDates();
	if (!r.possible) return null;
	return (
		<span className="inline-flex flex-wrap items-center gap-2" data-possible="">
			<span data-user-text="">
				<StatusDot
					kind="review"
					label={t("possible", {
						title: r.possible.title,
						date: short(r.possible.date),
					})}
					size="sm"
				/>
			</span>
			{kept ? (
				<Button kind="ghost" onClick={onSkip} size="sm">
					{t("skipOne")}
				</Button>
			) : null}
		</span>
	);
}

/** The status a row shows instead of its controls. */
function RowStatus({
	r,
	kept,
	onSkip,
}: {
	r: ReviewRow;
	kept: boolean;
	onSkip: () => void;
}) {
	const t = useTranslations("importPage.review");
	if (r.duplicate)
		return <StatusDot kind="settled" label={t("already")} size="sm" />;
	if (r.noRate) return <StatusDot kind="noRate" size="sm" />;
	return <PossibleFlag kept={kept} onSkip={onSkip} r={r} />;
}

/**
 * Review on desktop (import.html Table): one row per file row with the
 * include checkbox, the kind, the category and the amount at the money
 * edge. Rows already in Activity or without a rate cannot be included.
 */
export function ReviewTable({
	rows,
	choices,
	pick,
	onChoice,
	onKind,
	allKept,
	onAll,
}: ReviewBodyProps & { allKept: boolean; onAll: (keep: boolean) => void }) {
	const t = useTranslations("importPage.review");
	const { short } = useRowDates();
	return (
		<Table data-testid="import-table" look="panel">
			<TableHeader>
				<TableRow>
					<TableHead className="w-10">
						<Checkbox
							aria-label={t("col.select")}
							checked={allKept}
							onCheckedChange={(v) => onAll(v === true)}
						/>
					</TableHead>
					<TableHead>{t("col.date")}</TableHead>
					<TableHead>{t("col.title")}</TableHead>
					<TableHead>{t("col.kind")}</TableHead>
					<TableHead>{t("col.category")}</TableHead>
					<TableHead className="text-right">{t("col.amount")}</TableHead>
					<TableHead>
						<span className="sr-only">{t("col.status")}</span>
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((r) => {
					const c = choices[r.index];
					const kept = isKept(r, choices);
					return (
						<TableRow
							className={cn(!kept && "text-fg-3")}
							data-index={r.index}
							data-kept={kept}
							key={r.index}
						>
							<TableCell>
								<Checkbox
									aria-label={t("col.include", { title: r.title })}
									checked={kept}
									disabled={!importable(r)}
									onCheckedChange={(v) =>
										onChoice(r.index, { keep: v === true })
									}
								/>
							</TableCell>
							<TableCell className="text-fg-2 whitespace-nowrap">
								{short(r.date)}
							</TableCell>
							<TableCell className="max-w-72 truncate">{r.title}</TableCell>
							<TableCell>
								{importable(r) && c ? (
									<KindCell
										onChange={(k) => onKind(r.index, k)}
										r={r}
										value={c.kind}
									/>
								) : null}
							</TableCell>
							<TableCell>
								{importable(r) && c ? (
									<CategoryCell
										kind={c.kind}
										onChange={(id) => onChoice(r.index, { categoryId: id })}
										pick={pick}
										r={r}
										value={c.categoryId}
									/>
								) : null}
							</TableCell>
							<TableCell className="text-right">
								<RowMoney r={r} />
							</TableCell>
							<TableCell>
								<RowStatus
									kept={kept}
									onSkip={() => onChoice(r.index, { keep: false })}
									r={r}
								/>
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}

/** Review on a phone (import.html List): rows with the checkbox as lead. */
export function ReviewList({
	rows,
	choices,
	pick,
	onChoice,
	onKind,
}: ReviewBodyProps) {
	const t = useTranslations("importPage.review");
	const { short } = useRowDates();
	return (
		<RowList label={t("toolbar")}>
			{rows.map((r) => {
				const c = choices[r.index];
				const kept = isKept(r, choices);
				return (
					<Row
						className={cn(!kept && "text-fg-3")}
						data-index={r.index}
						data-kept={kept}
						end={<RowMoney inline={false} r={r} />}
						key={r.index}
						lead={
							<Checkbox
								aria-label={t("col.include", { title: r.title })}
								checked={kept}
								disabled={!importable(r)}
								onCheckedChange={(v) => onChoice(r.index, { keep: v === true })}
							/>
						}
						sub={
							<div className="text-fg-2 text-small mt-1 flex flex-wrap items-center gap-2">
								<span>{short(r.date)}</span>
								{importable(r) && c ? (
									<>
										<KindCell
											onChange={(k) => onKind(r.index, k)}
											r={r}
											value={c.kind}
										/>
										<CategoryCell
											kind={c.kind}
											onChange={(id) => onChoice(r.index, { categoryId: id })}
											pick={pick}
											r={r}
											value={c.categoryId}
										/>
									</>
								) : null}
								<RowStatus
									kept={kept}
									onSkip={() => onChoice(r.index, { keep: false })}
									r={r}
								/>
							</div>
						}
						title={r.title}
					/>
				);
			})}
		</RowList>
	);
}
