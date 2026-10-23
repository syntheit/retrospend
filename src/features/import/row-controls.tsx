"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Money } from "~/components/money/money";
import {
	CategoryPicker,
	type PickerCategory,
} from "~/components/pickers/category-picker";
import { PickerPopover } from "~/components/pickers/picker-popover";
import { FilterChip } from "~/components/ui/chip";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { StatusDot } from "~/components/ui/status-dot";
import { IMPORT_KINDS, type ImportKind } from "~/server/services/import/rows";
import type { ReviewRow } from "./choices";

export type ImportCategory = PickerCategory & { kind: "EXPENSE" | "INCOME" };

/** What a row's category chip and picker need. */
export interface CategoryPick {
	categories: readonly ImportCategory[];
	recentIds: readonly string[];
}

/** The categories a row of `kind` can take: income ones for income only. */
export const categoriesFor = (pick: CategoryPick, kind: ImportKind) =>
	pick.categories.filter(
		(c) => c.kind === (kind === "income" ? "INCOME" : "EXPENSE"),
	);

/** The figure ids a review row's money carries (e2e audit vs importQueue.review). */
export const amountFigure = (r: ReviewRow) => `import.amount:${r.index}`;
export const homeFigure = (r: ReviewRow) => `import.home:${r.index}`;

function RateTip({ r }: { r: ReviewRow }) {
	const t = useTranslations("importPage.rateType");
	if (!r.rate) return null;
	const type = r.rate.type;
	return (
		<span className="tabular-nums">
			<Money value={r.rate.unit} />
			{" = "}
			<Money value={r.rate.value} />
			{type ? ` · ${t.has(type) ? t(type as "blue") : type}` : null}
		</span>
	);
}

/**
 * A row's amount: the original first, the home value the import saves
 * second (R10), with the rate behind it on hover. No rate: "No rate yet".
 */
export function RowMoney({
	r,
	inline = true,
}: {
	r: ReviewRow;
	inline?: boolean;
}) {
	if (r.amount.currency === r.home?.currency)
		return <Money figure={homeFigure(r)} value={r.home} />;
	return (
		<Money.pair
			figure={amountFigure(r)}
			home={r.home}
			homeFigure={homeFigure(r)}
			inline={inline}
			original={r.amount}
			tip={<RateTip r={r} />}
		/>
	);
}

/** The category chip: the name, or "No category" as a status; opens the one picker. */
export function CategoryCell({
	r,
	kind,
	value,
	pick,
	onChange,
}: {
	r: ReviewRow;
	kind: ImportKind;
	value: string | null;
	pick: CategoryPick;
	onChange: (id: string) => void;
}) {
	const t = useTranslations("importPage.review");
	const [open, setOpen] = useState(false);
	const list = categoriesFor(pick, kind);
	const current = list.find((c) => c.id === value);
	return (
		<PickerPopover
			onOpenChange={setOpen}
			open={open}
			title={t("categoryPicker", { title: r.title })}
			trigger={
				<FilterChip
					aria-haspopup="dialog"
					aria-label={t("categoryPicker", { title: r.title })}
					className="max-w-48"
					value
				>
					{current ? (
						<span className="truncate">{current.name}</span>
					) : (
						<StatusDot kind="review" label={t("noCategory")} size="sm" />
					)}
				</FilterChip>
			}
		>
			<CategoryPicker
				categories={list}
				onChange={(id) => {
					onChange(id);
					setOpen(false);
				}}
				recentIds={pick.recentIds}
				value={value}
			/>
		</PickerPopover>
	);
}

/** The kind a row is imported as; proposed by the review, changeable here. */
export function KindCell({
	r,
	value,
	onChange,
}: {
	r: ReviewRow;
	value: ImportKind;
	onChange: (kind: ImportKind) => void;
}) {
	const t = useTranslations("importPage");
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<FilterChip
					aria-label={t("review.kindMenu", { title: r.title })}
					data-kind={value}
					value
				>
					{t(`kind.${value}`)}
				</FilterChip>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				<DropdownMenuRadioGroup
					onValueChange={(v) => onChange(v as ImportKind)}
					value={value}
				>
					{IMPORT_KINDS.map((k) => (
						<DropdownMenuRadioItem key={k} value={k}>
							{t(`kind.${k}`)}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
