"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Toolbar } from "~/components/layout/toolbar";
import { Button } from "~/components/ui/button";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Notice } from "~/components/ui/notice";
import { Segmented } from "~/components/ui/segmented";
import { Tip } from "~/components/ui/tooltip";
import type { ImportReview } from "~/server/services/import/review";
import type { ReviewCounts } from "./choices";

export type ReviewView = "table" | "cards" | "list";

/** "galicia.csv · 16 rows in the file: 12 to import · 2 already in Activity · 2 skipped". */
export function CountsLine({
	review,
	counts,
}: {
	review: ImportReview;
	counts: ReviewCounts;
}) {
	const t = useTranslations("importPage.review");
	const c = review.counts;
	const skipped = counts.unchecked + c.unreadable + c.noRate;
	const parts = [
		counts.duplicates ? t("dups", { count: counts.duplicates }) : null,
		skipped ? t("skipped", { count: skipped }) : null,
	].filter(Boolean);
	return (
		<p
			className="text-fg-2 text-small min-w-50 flex-1"
			data-testid="import-counts"
		>
			<span className="text-fg font-semibold">{review.fileName}</span>
			{" · "}
			{t("summary", { rows: c.fileRows, toImport: counts.kept })}
			{parts.map((p) => ` · ${p}`).join("")}
		</p>
	);
}

/**
 * The one notice of the review: categories that need a match first (with
 * Match categories), else the rows the file has that cannot be read.
 */
export function ReviewNotice({
	unmatched,
	unreadable,
	phone,
	dismissed,
	onDismiss,
	onMatch,
}: {
	unmatched: readonly { name: string; rows: number }[];
	unreadable: number;
	phone: boolean;
	dismissed: boolean;
	onDismiss: () => void;
	onMatch: () => void;
}) {
	const t = useTranslations("importPage.review");
	if (unmatched.length > 0)
		return (
			<Notice
				action={
					<Button kind="secondary" onClick={onMatch} size="sm">
						{t("match")}
					</Button>
				}
				className="mb-4"
				tone="attention"
			>
				{phone
					? t("unmatchedShort", { count: unmatched.length })
					: t("unmatched", {
							count: unmatched.length,
							list: unmatched.map((u) => `${u.name} (${u.rows})`).join(", "),
						})}
			</Notice>
		);
	if (unreadable > 0 && !dismissed)
		return (
			<Notice
				action={
					<Tip content={t("dismiss")}>
						<Button
							aria-label={t("dismiss")}
							icon
							kind="ghost"
							onClick={onDismiss}
							size="sm"
						>
							<X />
						</Button>
					</Tip>
				}
				className="mb-4"
			>
				{t("unreadable", { count: unreadable })}
			</Notice>
		);
	return null;
}

/**
 * The views of the rows (import.html: on the counts line): Table or Cards on
 * desktop, Cards or List on phones.
 */
export function ViewSwitch({
	view,
	onView,
	phone,
}: {
	view: ReviewView;
	onView: (v: ReviewView) => void;
	phone: boolean;
}) {
	const t = useTranslations("importPage.review");
	return (
		<Segmented
			label={t("view.label")}
			onChange={onView}
			options={
				phone
					? [
							{ value: "cards", label: t("view.cards") },
							{ value: "list", label: t("view.list") },
						]
					: [
							{ value: "table", label: t("view.table") },
							{ value: "cards", label: t("view.cards") },
						]
			}
			value={view}
		/>
	);
}

/** Currency for every row, Show already in Activity, Change how it is read: every view has them. */
export function ReviewToolbar({
	review,
	currency,
	onCurrency,
	showDups,
	onShowDups,
	dups,
	onReread,
	phone,
}: {
	review: ImportReview;
	currency: string | null;
	onCurrency: (code: string | null) => void;
	showDups: boolean;
	onShowDups: (on: boolean) => void;
	dups: number;
	onReread: (() => void) | null;
	phone: boolean;
}) {
	const t = useTranslations("importPage.review");
	const codes = [
		...new Set([review.homeCurrency, ...review.currencies]),
	].sort();
	return (
		<Toolbar label={t("toolbar")}>
			<FilterChips
				className={phone ? "overflow-x-auto" : undefined}
				label={t("toolbar")}
			>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<FilterChip value>
							{currency ? t("currency", { code: currency }) : t("currencyFile")}
						</FilterChip>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start">
						<DropdownMenuRadioGroup
							onValueChange={(v) => onCurrency(v === "file" ? null : v)}
							value={currency ?? "file"}
						>
							<DropdownMenuRadioItem value="file">
								{t("asInFile")}
							</DropdownMenuRadioItem>
							{codes.map((code) => (
								<DropdownMenuRadioItem key={code} value={code}>
									{code}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>
				{dups > 0 ? (
					<FilterChip onClick={() => onShowDups(!showDups)} selected={showDups}>
						{t("showDups", { count: dups })}
					</FilterChip>
				) : null}
				{onReread ? (
					<FilterChip onClick={onReread}>{t("reread")}</FilterChip>
				) : null}
			</FilterChips>
		</Toolbar>
	);
}

/** "12 will be imported · 2 already in Activity are skipped" with Back and Import. */
export function ImportBar({
	kept,
	dups,
	onBack,
	onImport,
}: {
	kept: number;
	dups: number;
	onBack: () => void;
	onImport: () => void;
}) {
	const t = useTranslations("importPage.review");
	return (
		<div className="mt-4 flex flex-wrap items-center gap-3 py-3">
			<p className="text-fg-2 text-small min-w-40 flex-1">
				{t("bar", { count: kept })}
				{dups ? ` · ${t("barDups", { count: dups })}` : ""}
			</p>
			<Button kind="ghost" onClick={onBack}>
				{t("back")}
			</Button>
			<Button disabled={kept === 0} kind="primary" onClick={onImport}>
				{t("import", { count: kept })}
			</Button>
		</div>
	);
}
