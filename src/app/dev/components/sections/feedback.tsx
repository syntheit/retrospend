"use client";

import {
	ArrowLeftRight,
	ArrowRightLeft,
	Banknote,
	CircleCheck,
	Handshake,
	Inbox,
	type LucideIcon,
	Plus,
	Repeat2,
	RotateCcw,
	Search,
} from "lucide-react";
import { useState } from "react";
import { Money } from "~/components/money/money";
import { Row, RowList } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { Notice } from "~/components/ui/notice";
import { SkeletonRows } from "~/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";
import { m } from "../fixtures/rows";
import { Cap, Pair, Spec } from "../spec";

/** Sample copy inside the samples: fixtures, like the numbers. */
const S = {
	emptyTitle: "No recurring expenses",
	emptyHint: "Add one to see when it is due.",
	addRecurring: "Add recurring expense",
	importing: "Importing 41 expenses.",
	rate: "Rate for BRL is from Oct 18.",
	server: "Could not reach the server.",
	refresh: "Refresh",
	retry: "Retry",
	toastCap: "Toast with Undo. Try the live one.",
	showToast: "Show toast",
	added: "Expense added",
	skeleton: "Skeleton",
	where: "Where",
	before: "Before",
	after: "After",
	why: "Why",
	tabs: "Underline tabs: the indicator slides (220ms)",
	rows: "Row removed, then Undo (200ms)",
	replay: "Replay",
	expenses: "Expenses",
	summary: "Summary",
	people: "People",
	pane: "pane",
	noIcon: "no icon",
	kept: "Everything else kept.",
};

const ICONS: [string, LucideIcon, LucideIcon | null, string][] = [
	[
		"Settle up, Settle all",
		Handshake,
		Banknote,
		"A payment, not an agreement (N66)",
	],
	[
		"Confirm a payment (Needs you)",
		Handshake,
		CircleCheck,
		"Confirming, not settling",
	],
	[
		"Exchange rate chip",
		Repeat2,
		ArrowRightLeft,
		"An exchange; repeat means recurring",
	],
	[
		"Rate alternatives",
		ArrowLeftRight,
		null,
		"Label only: two near-identical arrows sat side by side",
	],
	[
		"iPhone trailing glass button",
		Search,
		Plus,
		"Adds a plain expense, or the screen's context (N65)",
	],
];

export function RefreshSection() {
	const cell = "border-line border-t px-3 py-2";
	return (
		<Spec id="refresh">
			<div className="rounded-panel border-line bg-surface text-body grid grid-cols-[auto_auto_auto_1fr] overflow-hidden border">
				{[S.where, S.before, S.after, S.why].map((h) => (
					<span className="text-fg-3 text-meta px-3 py-2 font-medium" key={h}>
						{h}
					</span>
				))}
				{ICONS.map(([where, Before, After, why]) => (
					<div className="contents" key={where}>
						<span className={cell}>{where}</span>
						<span className={cn(cell, "text-fg-2")}>
							<Before aria-hidden="true" className="size-4" />
						</span>
						<span className={cn(cell, "text-fg-2")}>
							{After ? (
								<After aria-hidden="true" className="size-4" />
							) : (
								<span className="text-meta">{S.noIcon}</span>
							)}
						</span>
						<span className={cn(cell, "text-fg-2 text-small")}>{why}</span>
					</div>
				))}
			</div>
			<Cap className="mt-3">{S.kept}</Cap>
		</Spec>
	);
}

export function MotionSection() {
	const [gone, setGone] = useState(false);
	const replay = () => {
		setGone(true);
		window.setTimeout(() => setGone(false), 700);
	};
	const rows: [string, string][] = [
		["Café del Sur", "6400"],
		["Uber", "12800"],
		["Super Norte", "58300"],
	];
	return (
		<Spec id="motion">
			<div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
				<div>
					<Cap>{S.tabs}</Cap>
					<Tabs defaultValue="a">
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
				</div>
				<div>
					<div className="mb-1 flex items-center justify-between">
						<Cap className="mb-0">{S.rows}</Cap>
						<Button kind="secondary" onClick={replay} size="sm">
							<RotateCcw />
							{S.replay}
						</Button>
					</div>
					<RowList className="max-w-90" variant="flat">
						{rows.map(([title, amount], i) => (
							<Row
								className={cn(
									"ease-land overflow-hidden transition-all duration-(--t-row)",
									i === 1 && gone && "min-h-0 py-0 opacity-0 *:max-h-0",
								)}
								end={<Money value={m(amount)} />}
								key={title}
								title={title}
							/>
						))}
					</RowList>
				</div>
			</div>
		</Spec>
	);
}

export function FeedbackSection() {
	const toast = useToast();
	const empty = (
		<Empty
			action={
				<Button kind="secondary" size="sm">
					{S.addRecurring}
				</Button>
			}
			hint={S.emptyHint}
			icon={Inbox}
			title={S.emptyTitle}
		/>
	);
	return (
		<Spec id="feedback">
			<Pair
				desktop={
					<>
						<div className="w-80">{empty}</div>
						<div className="mt-4 flex flex-col gap-2">
							<Notice tone="info">{S.importing}</Notice>
							<Notice
								action={
									<Button kind="secondary" size="sm">
										{S.refresh}
									</Button>
								}
								tone="attention"
							>
								{S.rate}
							</Notice>
							<Notice
								action={
									<Button kind="secondary" size="sm">
										{S.retry}
									</Button>
								}
								tone="danger"
							>
								{S.server}
							</Notice>
						</div>
					</>
				}
				phone={
					<>
						{empty}
						<Notice tone="attention">{S.rate}</Notice>
					</>
				}
			/>
			<div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
				<div>
					<Cap>{S.toastCap}</Cap>
					<Button
						kind="secondary"
						onClick={() => toast.saved(S.added, { undo: () => undefined })}
					>
						{S.showToast}
					</Button>
				</div>
				<div>
					<Cap>{S.skeleton}</Cap>
					<SkeletonRows count={2} />
				</div>
			</div>
		</Spec>
	);
}
