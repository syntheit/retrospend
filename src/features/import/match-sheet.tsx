"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CategoryPicker } from "~/components/pickers/category-picker";
import { PickerPopover } from "~/components/pickers/picker-popover";
import { Row, RowList } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { FilterChip } from "~/components/ui/chip";
import { Sheet } from "~/components/ui/sheet";
import { CATEGORY_COLORS } from "~/lib/constants";
import { type CategoryPick, categoriesFor } from "./row-controls";

/** "Create" or an existing category, per unmatched file category. */
export type MatchPick = { create: true } | { id: string };

export type Unmatched = {
	name: string;
	rows: number;
	suggestionId: string | null;
};

/** A new category's color: the same for the same name, from the palette. */
export function colorFor(name: string) {
	let sum = 0;
	for (const ch of name) sum += ch.charCodeAt(0);
	return CATEGORY_COLORS[sum % CATEGORY_COLORS.length] ?? "blue";
}

function PickChip({
	u,
	value,
	pick,
	onChange,
}: {
	u: Unmatched;
	value: MatchPick;
	pick: CategoryPick;
	onChange: (v: MatchPick) => void;
}) {
	const t = useTranslations("importPage.match");
	const [open, setOpen] = useState(false);
	const list = categoriesFor(pick, "expense");
	const label =
		"create" in value
			? t("create", { name: u.name })
			: (list.find((c) => c.id === value.id)?.name ?? u.name);
	return (
		<PickerPopover
			onOpenChange={setOpen}
			open={open}
			title={t("pick", { name: u.name })}
			trigger={
				<FilterChip
					aria-label={t("pick", { name: u.name })}
					className="max-w-56"
					value
				>
					<span className="truncate">{label}</span>
				</FilterChip>
			}
		>
			<Button
				className="mb-2 w-full justify-start"
				kind="ghost"
				onClick={() => {
					onChange({ create: true });
					setOpen(false);
				}}
			>
				<Plus aria-hidden="true" />
				{t("create", { name: u.name })}
			</Button>
			<CategoryPicker
				categories={list}
				onChange={(id) => {
					onChange({ id });
					setOpen(false);
				}}
				recentIds={pick.recentIds}
				value={"id" in value ? value.id : null}
			/>
		</PickerPopover>
	);
}

/**
 * Match categories (IMPLEMENTATION §1.2): one row per category name in the
 * file that matched none of yours. Map it to one of yours (the suggestion
 * from your history first) or create it; Apply sets it on every row with
 * that name at once, and its toast undoes both.
 */
export function MatchSheet({
	open,
	onOpenChange,
	unmatched,
	pick,
	onApply,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	unmatched: readonly Unmatched[];
	pick: CategoryPick;
	onApply: (picks: Record<string, MatchPick>) => Promise<void>;
}) {
	const t = useTranslations("importPage.match");
	const [picks, setPicks] = useState<Record<string, MatchPick>>({});
	useEffect(() => {
		if (!open) return;
		setPicks(
			Object.fromEntries(
				unmatched.map((u) => [
					u.name,
					u.suggestionId ? { id: u.suggestionId } : { create: true },
				]),
			),
		);
	}, [open, unmatched]);
	return (
		<Sheet
			description={t("hint")}
			detent="medium"
			onOpenChange={onOpenChange}
			onSubmit={() => onApply(picks)}
			open={open}
			submitLabel={t("apply")}
			title={t("title")}
		>
			<RowList label={t("title")} variant="flat">
				{unmatched.map((u) => (
					<Row
						data-match={u.name}
						end={
							<PickChip
								onChange={(v) => setPicks({ ...picks, [u.name]: v })}
								pick={pick}
								u={u}
								value={picks[u.name] ?? { create: true }}
							/>
						}
						key={u.name}
						sub={
							<span className="text-fg-3 text-small">
								{t("rows", { count: u.rows })}
								{u.suggestionId ? ` · ${t("suggested")}` : ""}
							</span>
						}
						title={u.name}
					/>
				))}
			</RowList>
		</Sheet>
	);
}
