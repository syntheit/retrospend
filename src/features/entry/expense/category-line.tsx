"use client";

import { EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CategoryPicker } from "~/components/pickers/category-picker";
import { PickerPopover } from "~/components/pickers/picker-popover";
import { FilterChip } from "~/components/ui/chip";
import { Tip } from "~/components/ui/tooltip";
import { useIsMobile } from "~/hooks/use-mobile";
import { cn } from "~/lib/cn";
import type { EntryCatalog } from "../shared-ui";

type Category = EntryCatalog["categories"][number];

/** The recents line: a picked category outside the recents takes the first slot; nothing moves while you tap. */
export function lineIds(
	recents: readonly string[],
	all: readonly Category[],
	picked: string | null,
	n: number,
): string[] {
	const known = new Set(all.map((c) => c.id));
	const pool = [...recents, ...all.map((c) => c.id)].filter(
		(id, i, a) => known.has(id) && a.indexOf(id) === i,
	);
	const ids = pool.slice(0, n);
	if (picked && known.has(picked) && !ids.includes(picked))
		return [picked, ...ids.slice(0, n - 1)];
	return ids;
}

/**
 * Category: one fixed line of recents (4 on desktop, 3 on a phone) and All,
 * which opens the one CategoryPicker. Text-only chips, selected by fill;
 * the auto-picked one gets a short ring. A category not counted in spending
 * says so.
 */
export function CategoryLine({
	categories,
	recents,
	value,
	ring,
	onPick,
	kind = "EXPENSE",
}: {
	categories: readonly Category[];
	recents: readonly string[];
	value: string | null;
	ring?: boolean;
	onPick: (id: string) => void;
	kind?: "EXPENSE" | "INCOME";
}) {
	const t = useTranslations("entry.expense");
	const phone = useIsMobile();
	const [open, setOpen] = useState(false);
	const mine = categories.filter((c) => c.kind === kind);
	const ids = lineIds(recents, mine, value, phone ? 3 : 4);
	const byId = new Map(mine.map((c) => [c.id, c]));
	return (
		<div
			aria-label={t("category")}
			className="flex flex-wrap items-center gap-2"
			role="group"
		>
			{ids.map((id) => {
				const c = byId.get(id);
				if (!c) return null;
				const on = value === id;
				const chip = (
					<FilterChip
						className={cn(
							on && ring && "outline-2 outline-brand outline-offset-2",
						)}
						key={id}
						onClick={() => onPick(id)}
						selected={on}
					>
						{c.name}
						{c.excludeByDefault ? (
							<EyeOff aria-label={t("notCounted")} />
						) : null}
					</FilterChip>
				);
				return c.excludeByDefault ? (
					<Tip content={t("notCounted")} key={id}>
						{chip}
					</Tip>
				) : (
					chip
				);
			})}
			<PickerPopover
				onOpenChange={setOpen}
				open={open}
				title={t("pickCategory")}
				trigger={
					<FilterChip value>
						{phone ? t("moreCategories") : t("allCategories")}
					</FilterChip>
				}
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
		</div>
	);
}
