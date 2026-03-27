"use client";

import {
	Check,
	Circle,
	Clock,
	Lock,
	Minus,
	Pencil,
	Plus,
	ShieldCheck,
	Trash2,
	XCircle,
} from "lucide-react";
import type { ComponentType } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type { RouterOutputs } from "~/trpc/react";
import { api } from "~/trpc/react";

// ── Types ──────────────────────────────────────────────────────────────────

type TransactionHistory = RouterOutputs["auditLog"]["transactionHistory"];
type Entry = TransactionHistory["entries"][number];
type FieldChange = Extract<
	NonNullable<Entry["detail"]>,
	{ type: "field_changes" }
>["changes"][number];
type Snapshot = Extract<
	NonNullable<Entry["detail"]>,
	{ type: "creation_snapshot" }
>["snapshot"];

// ── Icon & Color Mapping ───────────────────────────────────────────────────

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
	plus: Plus,
	pencil: Pencil,
	check: Check,
	"x-circle": XCircle,
	clock: Clock,
	trash: Trash2,
	lock: Lock,
	minus: Minus,
	circle: Circle,
};

const colorStyles: Record<string, { bg: string; fg: string }> = {
	green: {
		bg: "bg-emerald-500/15",
		fg: "text-emerald-600 dark:text-emerald-400",
	},
	amber: {
		bg: "bg-amber-500/15",
		fg: "text-amber-600 dark:text-amber-400",
	},
	blue: {
		bg: "bg-blue-500/15",
		fg: "text-blue-600 dark:text-blue-400",
	},
	red: {
		bg: "bg-rose-500/15",
		fg: "text-rose-600 dark:text-rose-400",
	},
	sky: {
		bg: "bg-sky-500/15",
		fg: "text-sky-600 dark:text-sky-400",
	},
	gray: {
		bg: "bg-muted",
		fg: "text-muted-foreground",
	},
};

const defaultColor = colorStyles.gray!;

// ── Loading Skeleton ───────────────────────────────────────────────────────

function TimelineSkeleton() {
	return (
		<div className="relative pt-2 pl-8">
			<div className="absolute top-5 bottom-5 left-6 w-px bg-border" />
			{[0, 1, 2, 3].map((i) => (
				<div className="relative pb-6" key={i}>
					<div className="absolute top-0.5 -left-5">
						<Skeleton
							className="h-6 w-6 rounded-full"
							style={{ animationDelay: `${i * 50}ms` }}
						/>
					</div>
					<div className="space-y-2">
						<Skeleton
							className="h-4 w-48"
							style={{ animationDelay: `${i * 50}ms` }}
						/>
						<Skeleton
							className="h-4 w-64"
							style={{ animationDelay: `${i * 50}ms` }}
						/>
					</div>
				</div>
			))}
		</div>
	);
}

// ── Field Change Components ────────────────────────────────────────────────

function FieldChangeRow({ change }: { change: FieldChange }) {
	if (change.field === "participant_added") {
		return (
			<div className="px-3 py-2">
				<div className="flex items-center gap-1.5 text-sm">
					<span className="text-muted-foreground">+</span>
					<span>{change.label}</span>
				</div>
				{change.newValue && (
					<div className="mt-0.5 text-muted-foreground text-xs">
						{change.newValue}
					</div>
				)}
			</div>
		);
	}

	if (change.field === "participant_removed") {
		return (
			<div className="px-3 py-2">
				<div className="flex items-center gap-1.5 text-sm">
					<span className="text-muted-foreground">&minus;</span>
					<span className="text-muted-foreground line-through">
						{change.label}
					</span>
				</div>
				{change.oldValue && (
					<div className="mt-0.5 text-muted-foreground text-xs">
						Was: {change.oldValue}
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="px-3 py-2">
			<div className="font-medium text-muted-foreground text-xs tracking-wide">
				{change.label}
			</div>
			<div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm">
				<span className="text-muted-foreground line-through">
					{change.oldValue}
				</span>
				<span className="text-muted-foreground">&rarr;</span>
				<span>{change.newValue}</span>
			</div>
		</div>
	);
}

function FieldChangeList({ changes }: { changes: FieldChange[] }) {
	return (
		<div className="mt-2 overflow-hidden rounded-lg border border-border bg-muted/40">
			{changes.map((change, i) => (
				<div key={`${change.field}-${i}`}>
					{i > 0 && <div className="border-border border-t" />}
					<FieldChangeRow change={change} />
				</div>
			))}
		</div>
	);
}

// ── Snapshot Component ─────────────────────────────────────────────────────

function SnapshotView({
	snapshot,
	isDeleted,
}: {
	snapshot: Snapshot;
	isDeleted?: boolean;
}) {
	const participants = snapshot.participants
		.map((p) => `${p.name} (${p.share})`)
		.join(", ");

	return (
		<div
			className={cn(
				"mt-2 space-y-0.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-muted-foreground/80 text-xs",
				isDeleted && "opacity-75",
			)}
		>
			<div>
				{snapshot.amount} {snapshot.currency} &middot; {snapshot.splitMode}{" "}
				split
			</div>
			<div>Paid by {snapshot.paidBy}</div>
			{participants && <div>{participants}</div>}
			{isDeleted && <div className="mt-1 italic">This expense was deleted</div>}
		</div>
	);
}

// ── Entry Detail Renderer ──────────────────────────────────────────────────

function EntryDetail({ detail }: { detail: NonNullable<Entry["detail"]> }) {
	switch (detail.type) {
		case "field_changes":
			return <FieldChangeList changes={detail.changes} />;
		case "creation_snapshot":
			return <SnapshotView snapshot={detail.snapshot} />;
		case "deletion_snapshot":
			return <SnapshotView isDeleted snapshot={detail.snapshot} />;
		case "rejection":
			return detail.reason ? (
				<div className="mt-2 rounded-md border-rose-500/50 border-l-2 bg-muted/30 px-3 py-2 text-muted-foreground text-sm italic">
					&ldquo;{detail.reason}&rdquo;
				</div>
			) : null;
		case "verification":
			return detail.note ? (
				<div className="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-muted-foreground text-xs">
					{detail.note}
				</div>
			) : null;
		default:
			return null;
	}
}

// ── Timeline Entry ─────────────────────────────────────────────────────────

function TimelineEntryView({
	entry,
	isLast,
}: {
	entry: Entry;
	isLast: boolean;
}) {
	const c = colorStyles[entry.action.color] ?? defaultColor;
	const Icon = iconMap[entry.action.icon] ?? Circle;

	return (
		<div className={cn("relative", !isLast && "pb-6")}>
			{/* Connector line to next entry */}
			{!isLast && (
				<div className="absolute -left-2 top-3 -bottom-3 w-px bg-border" />
			)}

			{/* Colored dot on the timeline */}
			<div
				className={cn(
					"absolute top-0 -left-5 flex h-6 w-6 items-center justify-center rounded-full",
					c.bg,
				)}
			>
				<Icon className={cn("h-3.5 w-3.5", c.fg)} />
			</div>

			{/* Entry content */}
			<div className="min-w-0">
				{/* Header: action label, actor, time */}
				<div className="flex flex-wrap items-center gap-1 text-sm">
					<span className={cn("font-semibold", c.fg)}>
						{entry.action.label}
					</span>
					{entry.actor.type !== "system" && (
						<>
							<span className="text-muted-foreground">&middot;</span>
							<span className="text-muted-foreground">{entry.actor.name}</span>
						</>
					)}
					<span className="text-muted-foreground">&middot;</span>
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="cursor-default text-muted-foreground text-xs">
								{entry.relativeTime}
							</span>
						</TooltipTrigger>
						<TooltipContent>
							{new Date(entry.timestamp).toLocaleString("en-US", {
								month: "short",
								day: "numeric",
								year: "numeric",
								hour: "numeric",
								minute: "2-digit",
								hour12: true,
							})}
						</TooltipContent>
					</Tooltip>
				</div>

				{/* Summary */}
				<p className="mt-0.5 text-foreground/80 text-sm">{entry.summary}</p>

				{/* Detail (conditional) */}
				{entry.detail && <EntryDetail detail={entry.detail} />}
			</div>
		</div>
	);
}

// ── Timeline ───────────────────────────────────────────────────────────────

function RevisionTimeline({ entries }: { entries: Entry[] }) {
	const isOnlyCreation = entries.length === 1;

	return (
		<div className="relative pl-8">
			{entries.map((entry, i) => (
				<TimelineEntryView
					entry={entry}
					isLast={i === entries.length - 1}
					key={entry.id}
				/>
			))}
			{isOnlyCreation && (
				<div className="mt-6 flex flex-col items-center gap-2.5 rounded-lg border border-border border-dashed bg-muted/20 px-4 py-6 text-center">
					<ShieldCheck className="h-6 w-6 text-muted-foreground/40" />
					<div>
						<p className="text-muted-foreground text-sm">
							No changes have been made to this expense.
						</p>
						<p className="mt-1 text-muted-foreground/60 text-xs">
							Any edits will appear here with a full history of what changed.
						</p>
					</div>
				</div>
			)}
		</div>
	);
}

// ── Header ─────────────────────────────────────────────────────────────────

function RevisionHistoryHeader({ data }: { data: TransactionHistory }) {
	const { transaction, entries } = data;
	const editEntries = entries.filter((e) => e.action.type === "edited");
	const editCount = editEntries.length;
	const lastEdit = editEntries[editEntries.length - 1];

	return (
		<div className="space-y-1.5">
			<p className="font-medium text-sm">{transaction.description}</p>
			<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
				<span>
					{transaction.amount} {transaction.currency}
				</span>
				{transaction.isDeleted && (
					<Badge
						className="bg-rose-500/10 text-[10px] text-rose-600 dark:text-rose-400"
						variant="outline"
					>
						Deleted
					</Badge>
				)}
				{transaction.isLocked && !transaction.isDeleted && (
					<Badge
						className="text-[10px] text-muted-foreground"
						variant="outline"
					>
						Settled
					</Badge>
				)}
			</div>
			{editCount > 0 && lastEdit && (
				<p className="text-muted-foreground text-xs">
					{editCount} edit{editCount !== 1 ? "s" : ""} &middot; Last edited by{" "}
					{lastEdit.actor.name}, {lastEdit.relativeTime}
				</p>
			)}
		</div>
	);
}

// ── Data Hook ──────────────────────────────────────────────────────────────

function useTransactionHistory(transactionId: string | null) {
	return api.auditLog.transactionHistory.useQuery(
		{ transactionId: transactionId! },
		{ enabled: transactionId !== null },
	);
}

// ── Main Drawer ────────────────────────────────────────────────────────────

interface RevisionHistoryDrawerProps {
	transactionId: string | null;
	onClose: () => void;
}

export function RevisionHistoryDrawer({
	transactionId,
	onClose,
}: RevisionHistoryDrawerProps) {
	const isOpen = transactionId !== null;
	const { data, isLoading, isError, refetch } =
		useTransactionHistory(transactionId);

	return (
		<Sheet onOpenChange={(open) => !open && onClose()} open={isOpen}>
			<SheetContent
				aria-label="Revision history"
				className="w-full gap-0 sm:max-w-full md:max-w-[420px] lg:max-w-[480px]"
				side="right"
			>
				<SheetHeader className="border-b px-6 py-4 pr-12">
					<SheetTitle>Revision History</SheetTitle>
					<SheetDescription className="sr-only">
						{data
							? `Timeline of changes for ${data.transaction.description}`
							: "Loading revision history"}
					</SheetDescription>
					{data && <RevisionHistoryHeader data={data} />}
				</SheetHeader>

				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
					{isLoading && (
						<div
							className="animate-in fade-in-0 duration-200"
							style={{
								animationDelay: "150ms",
								animationFillMode: "backwards",
							}}
						>
							<TimelineSkeleton />
						</div>
					)}
					{isError && (
						<div className="flex flex-col items-center justify-center gap-3 py-12">
							<p className="text-muted-foreground text-sm">
								Couldn&apos;t load revision history
							</p>
							<Button
								onClick={() => void refetch()}
								size="sm"
								variant="outline"
							>
								Try again
							</Button>
						</div>
					)}
					{data && data.entries.length === 0 && (
						<div className="flex flex-col items-center justify-center gap-2 py-12">
							<p className="text-muted-foreground text-sm">
								No history available for this expense
							</p>
						</div>
					)}
					{data && data.entries.length > 0 && (
						<RevisionTimeline entries={data.entries} />
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}
