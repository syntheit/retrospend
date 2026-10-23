"use client";

import { EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState } from "react";
import {
	CategoryGlyph,
	CategoryPicker,
} from "~/components/pickers/category-picker";
import { PickerPopover } from "~/components/pickers/picker-popover";
import { FilterChip } from "~/components/ui/chip";
import { Tip } from "~/components/ui/tooltip";
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

/** Up to this many recents; as many as fit beside All are shown. */
const LINE_MAX = 5;

/**
 * How many of the line's chips fit beside All in one row: each chip leads
 * with its glyph, so the count follows the width, not a fixed number.
 * Chips that do not fit stay measurable but invisible.
 */
function useFitCount(total: number) {
	const ref = useRef<HTMLDivElement>(null);
	const [fit, setFit] = useState(total);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => {
			const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
			const all = el.querySelector<HTMLElement>("[data-fit-all]");
			let used = all?.offsetWidth ?? 0;
			let n = 0;
			for (const chip of el.querySelectorAll<HTMLElement>("[data-fit]")) {
				used += chip.offsetWidth + gap;
				if (used > el.clientWidth) break;
				n++;
			}
			setFit(n);
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [total]);
	return { ref, fit };
}

/**
 * Category: one line of recents (as many as fit) and All, which opens the
 * one CategoryPicker. Each chip leads with the bare glyph in its category
 * color (R25: identity, no tile), selected by fill; the auto-picked one
 * gets a short ring. A category not counted in spending says so.
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
	const [open, setOpen] = useState(false);
	const mine = categories.filter((c) => c.kind === kind);
	const ids = lineIds(recents, mine, value, LINE_MAX);
	const byId = new Map(mine.map((c) => [c.id, c]));
	const { ref, fit } = useFitCount(ids.length);
	return (
		<div
			aria-label={t("category")}
			className="relative flex items-center gap-2"
			ref={ref}
			role="group"
		>
			{ids.map((id, i) => {
				const c = byId.get(id);
				if (!c) return null;
				const on = value === id;
				const chip = (
					<FilterChip
						className={cn(
							on && ring && "outline-2 outline-brand outline-offset-2",
							i >= fit && "invisible absolute",
						)}
						data-fit=""
						key={id}
						lead={<CategoryGlyph category={c} />}
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
					<FilterChip data-fit-all="" value>
						{t("allCategories")}
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
