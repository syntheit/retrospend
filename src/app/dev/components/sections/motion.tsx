"use client";

import { RotateCcw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Money } from "~/components/money/money";
import { Row, RowList } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { PageTabs } from "~/components/ui/page-tabs";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { cn } from "~/lib/cn";
import { m } from "../fixtures/rows";
import { Cap, Spec } from "../spec";
import { SheetDemo } from "./sheets";

/** Sample copy inside the samples: fixtures, like the numbers. */
const S = {
	tabs: "Underline tabs",
	tabsCap:
		"Indicator slides; the pane enters from the side of the tab order (220ms)",
	rows: "Row removed, then Undo",
	rowsCap: "Height and opacity collapse (200ms); Undo expands it back",
	num: "Number change",
	numCap:
		"The old digits leave upward, the new ones arrive from below. Never counts",
	sheet: "Sheet",
	sheetCap:
		"Rises with ease out (220ms), sinks with ease in. Phones drag the grabber",
	pages: "Sibling pages",
	pagesCap:
		"Activity Expenses, Recurring, Insights: one axis for the content and the underline",
	replay: "Replay",
	expenses: "Expenses",
	summary: "Summary",
	people: "People",
	recurring: "Recurring",
	insights: "Insights",
	add: "Add expense",
	saved: "Expense added",
};

function Demo({
	title,
	cap,
	onReplay,
	children,
}: {
	title: string;
	cap: string;
	onReplay?: () => void;
	children: ReactNode;
}) {
	return (
		<div className="min-w-0">
			<div className="mb-1 flex items-center justify-between gap-2">
				<b className="text-body font-semibold">{title}</b>
				{onReplay && (
					<Button kind="secondary" onClick={onReplay} size="sm">
						<RotateCcw />
						{S.replay}
					</Button>
				)}
			</div>
			<Cap>{cap}</Cap>
			{children}
		</div>
	);
}

const AMOUNTS = ["1385470", "1442180"];

export function MotionSection() {
	const [gone, setGone] = useState(false);
	const [flip, setFlip] = useState(0);
	const [tab, setTab] = useState("a");
	const [page, setPage] = useState("e");
	const pages = ["e", "r", "i"];
	const rows: [string, string][] = [
		["Café del Sur", "6400"],
		["Uber", "12800"],
		["Super Norte", "58300"],
	];
	return (
		<Spec id="motion">
			<div className="grid gap-x-8 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
				<Demo
					cap={S.tabsCap}
					onReplay={() =>
						setTab((t) => (t === "a" ? "b" : t === "b" ? "c" : "a"))
					}
					title={S.tabs}
				>
					<Tabs onValueChange={setTab} value={tab}>
						<TabsList variant="line">
							<TabsTrigger value="a">{S.expenses}</TabsTrigger>
							<TabsTrigger value="b">{S.summary}</TabsTrigger>
							<TabsTrigger value="c">{S.people}</TabsTrigger>
						</TabsList>
						<TabsContent value="a">
							<SkeletonRows count={2} />
						</TabsContent>
						<TabsContent className="text-fg-2 text-small py-3" value="b">
							{S.summary}
						</TabsContent>
						<TabsContent className="text-fg-2 text-small py-3" value="c">
							{S.people}
						</TabsContent>
					</Tabs>
				</Demo>
				<Demo
					cap={S.rowsCap}
					onReplay={() => {
						setGone(true);
						window.setTimeout(() => setGone(false), 700);
					}}
					title={S.rows}
				>
					<RowList className="max-w-90" variant="flat">
						{rows.map(([title, amount], i) => (
							<Row
								className={cn(
									"duration-(--t-row) ease-land overflow-hidden transition-all",
									i === 1 && gone && "min-h-0 py-0 opacity-0 *:max-h-0",
								)}
								end={<Money value={m(amount)} />}
								key={title}
								title={title}
							/>
						))}
					</RowList>
				</Demo>
				<Demo
					cap={S.numCap}
					onReplay={() => setFlip((f) => f + 1)}
					title={S.num}
				>
					<div className="overflow-hidden">
						<Money
							className="text-hero animate-in fade-in-0 slide-in-from-bottom-2 duration-(--t-num-in) block font-semibold"
							key={flip}
							value={m(AMOUNTS[flip % 2] ?? "0")}
						/>
					</div>
				</Demo>
				<Demo cap={S.sheetCap} title={S.sheet}>
					<SheetDemo done={S.saved} title={S.add} verb={S.add} />
				</Demo>
				<Demo
					cap={S.pagesCap}
					onReplay={() =>
						setPage((p) => pages[(pages.indexOf(p) + 1) % 3] ?? "e")
					}
					title={S.pages}
				>
					<PageTabs
						current={page}
						items={[
							{ id: "e", label: S.expenses, href: "#motion" },
							{ id: "r", label: S.recurring, href: "#motion" },
							{ id: "i", label: S.insights, href: "#motion" },
						]}
					/>
				</Demo>
			</div>
		</Spec>
	);
}
