"use client";

import {
	Calendar,
	ChevronDown,
	Ellipsis,
	type LucideIcon,
	Plus,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { FilterChip } from "~/components/ui/chip";
import { Tip } from "~/components/ui/tooltip";
import { cn } from "~/lib/cn";
import { FixtureCover } from "../fixtures/covers";
import { Cap, Spec } from "../spec";
import { ICONS, KEPT } from "./refresh-data";

/** Sample copy inside the samples: fixtures, like the numbers. */
const S = {
	where: "Where",
	before: "Before",
	after: "After",
	why: "Why",
	note: "Note",
	button: "Button",
	noIcon: "no icon",
	cover: "cover",
	kept: "Kept:",
	add: "Add expense",
	more: "More ways to add",
	unreviewed: "Unreviewed 12",
	oct: "Oct 2026",
	searchTab: "Search tab",
	plusGlass: "Plus glass button, brand-tinted",
	moreLabel: "More",
};

/** An icon with its lucide name under it, as the mockup's table shows it. */
function Named({ icon: Icon, name }: { icon: LucideIcon; name: string }) {
	return (
		<span className="inline-flex items-center gap-2">
			<Icon
				aria-hidden="true"
				className="text-fg-2 size-4"
				strokeWidth={1.75}
			/>
			<span className="text-fg-3 text-meta">{name}</span>
		</span>
	);
}

function Grid({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
	const cell = "border-line border-t px-3 py-2";
	return (
		<div className="rounded-panel border-line bg-surface text-body grid grid-cols-[auto_auto_auto_1fr] overflow-hidden border">
			{head.map((h) => (
				<span className="text-fg-3 text-meta px-3 py-2 font-medium" key={h}>
					{h}
				</span>
			))}
			{rows.map((r, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static table
				<div className="contents" key={i}>
					{r.map((c, j) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static table
						<span
							className={cn(cell, j === 3 && "text-fg-2 text-small")}
							key={j}
						>
							{c}
						</span>
					))}
				</div>
			))}
		</div>
	);
}

/** The desktop split Add: the verb and a caret holding Add income and Transfer. */
function SplitAdd() {
	return (
		<span className="inline-flex gap-0.5">
			<Button className="rounded-r-none" kind="primary">
				<Plus />
				{S.add}
			</Button>
			<Tip content={S.more}>
				<Button
					aria-label={S.more}
					className="rounded-l-none"
					icon
					kind="primary"
				>
					<ChevronDown />
				</Button>
			</Tip>
		</span>
	);
}

export function RefreshSection() {
	const icons = ICONS.map(([where, before, after, why]) => [
		where,
		<Named icon={before[0]} key="b" name={before[1]} />,
		after === "cover" ? (
			<span className="inline-flex items-center gap-2" key="a">
				<span className="rounded-ctl size-5 overflow-hidden *:size-full">
					<FixtureCover scene="sea" />
				</span>
				<span className="text-fg-3 text-meta">{S.cover}</span>
			</span>
		) : after ? (
			<Named icon={after[0]} key="a" name={after[1]} />
		) : (
			<span className="text-fg-3 text-meta" key="a">
				{S.noIcon}
			</span>
		),
		why,
	]);
	const icon = <Ellipsis />;
	const buttons: ReactNode[][] = [
		[
			"Primary",
			<Button key="b" kind="primary">
				<Plus />
				{S.add}
			</Button>,
			<Button key="a" kind="primary">
				<Plus />
				{S.add}
			</Button>,
			"Brand fill, one per page header. Icon + label",
		],
		[
			"Split button",
			<Button key="b" kind="primary">
				<Plus />
				{S.add}
			</Button>,
			<SplitAdd key="a" />,
			"Desktop Add only: Add expense, and the caret holds Add income and Transfer (N, I, T)",
		],
		[
			"Active filter chip",
			<FilterChip className="bg-brand border-brand text-brand-fg" key="b">
				{S.unreviewed}
			</FilterChip>,
			<FilterChip key="a" selected>
				{S.unreviewed}
			</FilterChip>,
			"Solid brand pill, heavy in a toolbar",
		],
		[
			"Value chip (a date range)",
			<FilterChip className="bg-brand border-brand text-brand-fg" key="b">
				{S.oct}
				<X />
			</FilterChip>,
			<FilterChip key="a" value>
				<Calendar />
				{S.oct}
			</FilterChip>,
			"Looked like an active filter (solid brand)",
		],
		[
			"iPhone add",
			<span className="text-fg-3 text-meta" key="b">
				{S.searchTab}
			</span>,
			<span className="text-fg-3 text-meta" key="a">
				{S.plusGlass}
			</span>,
			"Search tab beside the tab bar",
		],
		[
			"Icon-only",
			<Tip content={S.moreLabel} key="b">
				<Button aria-label={S.moreLabel} icon kind="ghost">
					{icon}
				</Button>
			</Tip>,
			<Tip content={S.moreLabel} key="a">
				<Button aria-label={S.moreLabel} icon kind="ghost">
					{icon}
				</Button>
			</Tip>,
			"Ghost, 32px, tooltip and aria-label. Use a label when it is the page's main action",
		],
	];
	return (
		<Spec id="refresh">
			<Grid head={[S.where, S.before, S.after, S.why]} rows={icons} />
			<div className="mt-3 flex flex-wrap items-center gap-3">
				<Cap className="mb-0">{S.kept}</Cap>
				{KEPT.map(([name, Icon]) => (
					<Icon
						aria-label={name}
						className="text-fg-2 size-4"
						key={name}
						strokeWidth={1.75}
					/>
				))}
			</div>
			<div className="mt-4">
				<Grid head={[S.button, S.before, S.after, S.note]} rows={buttons} />
			</div>
		</Spec>
	);
}
