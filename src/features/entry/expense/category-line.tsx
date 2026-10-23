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
 * How many recents fit beside All in one row: each chip leads with its
 * glyph, so the count follows the width. `line(n)` is the line of n chips
 * (the picked one first when it is not a recent); every candidate chip stays
 * rendered, the extra ones invisible, so each can be measured. Measures
 * again when the candidates or the pick change.
 */
function useFit(line: (n: number) => string[], key: string, max: number) {
	const ref = useRef<HTMLDivElement>(null);
	const [fit, setFit] = useState(max);
	const lineRef = useRef(line);
	lineRef.current = line;
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => {
			const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
			const width = new Map<string, number>();
			for (const chip of el.querySelectorAll<HTMLElement>("[data-fit]"))
				width.set(chip.dataset.fit ?? "", chip.offsetWidth);
			const all = el.querySelector<HTMLElement>("[data-fit-all]");
			let n = 0;
			for (let k = 1; k <= max; k++) {
				const used = lineRef
					.current(k)
					.reduce(
						(sum, id) => sum + (width.get(id) ?? 0) + gap,
						all?.offsetWidth ?? 0,
					);
				if (used > el.clientWidth) break;
				n = k;
			}
			setFit(n);
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [key, max]);
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
	const line = (n: number) => lineIds(recents, mine, value, n);
	const pool = line(LINE_MAX);
	const { ref, fit } = useFit(line, `${pool.join()}|${value}`, pool.length);
	// The picked category always shows: it takes the first slot when it is not a recent.
	const shown = line(fit);
	const ids = [...shown, ...pool.filter((id) => !shown.includes(id))];
	const byId = new Map(mine.map((c) => [c.id, c]));
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
							i >= shown.length && "invisible absolute",
						)}
						data-fit={id}
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
