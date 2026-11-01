"use client";

import { EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
	CategoryGlyph,
	CategoryPicker,
} from "~/components/pickers/category-picker";
import { PickerPopover } from "~/components/pickers/picker-popover";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { GlyphPill } from "~/components/ui/glyph-pill";
import { Tip } from "~/components/ui/tooltip";
import { useCategoryName } from "~/hooks/use-category-name";
import { cn } from "~/lib/cn";
import type { EntryCatalog } from "../shared-ui";
import { lineIds } from "./category-line";

type Category = EntryCatalog["categories"][number];

/** Most used first; the rest wait behind All categories. */
const SHOWN = 14;

/**
 * Category panel: wrapping pills, each with the category's bare glyph in
 * its color, most used first, then All categories (the one CategoryPicker).
 * The auto-picked one gets a short ring.
 */
export function CategoryPanel({
	categories,
	recents,
	value,
	ring,
	onPick,
}: {
	categories: readonly Category[];
	recents: readonly string[];
	value: string | null;
	ring?: boolean;
	onPick: (id: string) => void;
}) {
	const t = useTranslations("entry.expense");
	const { displayName } = useCategoryName();
	const [open, setOpen] = useState(false);
	const mine = categories.filter((c) => c.kind === "EXPENSE");
	const byId = new Map(mine.map((c) => [c.id, c]));
	const ids = lineIds(recents, mine, value, SHOWN);
	return (
		<FilterChips label={t("category")}>
			{ids.map((id) => {
				const c = byId.get(id);
				if (!c) return null;
				const on = value === id;
				const pill = (
					<GlyphPill
						className={cn(on && ring && "outline-brand outline-2 outline-offset-2")}
						key={id}
						lead={<CategoryGlyph category={c} />}
						onClick={() => onPick(id)}
						selected={on}
					>
						{displayName(c.name)}
						{c.excludeByDefault ? (
							<EyeOff aria-label={t("notCounted")} />
						) : null}
					</GlyphPill>
				);
				return c.excludeByDefault ? (
					<Tip content={t("notCounted")} key={id}>
						{pill}
					</Tip>
				) : (
					pill
				);
			})}
			{(
				<PickerPopover
					onOpenChange={setOpen}
					open={open}
					title={t("pickCategory")}
					trigger={<FilterChip value>{t("allCategoriesFull")}</FilterChip>}
				>
					<CategoryPicker
						categories={mine}
						onChange={(id) => {
							setOpen(false);
							onPick(id);
						}}
						recentIds={recents}
						value={value}
					/>
				</PickerPopover>
			)}
		</FilterChips>
	);
}
