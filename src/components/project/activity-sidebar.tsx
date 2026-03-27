"use client";

import { ArrowRight } from "lucide-react";
import { useMemo } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { UserAvatar } from "~/components/ui/user-avatar";
import { api, type RouterOutputs } from "~/trpc/react";
import { groupConsecutiveEntries } from "~/lib/activity-utils";

interface ActivitySidebarProps {
	projectId: string;
	onViewAll: () => void;
	maxGroups?: number;
}

function SidebarSkeleton() {
	return (
		<div className="space-y-3 pt-1">
			{[0, 1, 2, 3].map((i) => (
				<div className="flex items-start gap-2.5" key={i}>
					<Skeleton
						className="h-6 w-6 shrink-0 rounded-full"
						style={{ animationDelay: `${i * 60}ms` }}
					/>
					<div className="flex-1 space-y-1.5">
						<Skeleton
							className="h-3.5 w-full"
							style={{ animationDelay: `${i * 60}ms` }}
						/>
						<Skeleton
							className="h-3 w-16"
							style={{ animationDelay: `${i * 60}ms` }}
						/>
					</div>
				</div>
			))}
		</div>
	);
}

export function ActivitySidebar({ projectId, onViewAll, maxGroups }: ActivitySidebarProps) {
	const { data, isLoading } = api.auditLog.projectActivityFeed.useInfiniteQuery(
		{ projectId, limit: 15 },
		{
			getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
			initialCursor: undefined,
		},
	);

	const allGrouped = useMemo(
		() => groupConsecutiveEntries(data?.pages[0]?.entries ?? []),
		[data],
	);
	const grouped = maxGroups ? allGrouped.slice(0, maxGroups) : allGrouped;
	const totalCount = data?.pages[0]?.totalCount ?? 0;

	return (
		<Card className="overflow-hidden">
			<CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
				<span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
					Recent Activity
				</span>
				{totalCount > 0 && (
					<span className="text-[11px] text-muted-foreground tabular-nums">
						{totalCount}
					</span>
				)}
			</CardHeader>
			<CardContent className="px-2 pb-0">
				{isLoading && <SidebarSkeleton />}

				{!isLoading && grouped.length === 0 && (
					<p className="py-6 text-center text-xs text-muted-foreground">
						No activity yet
					</p>
				)}

				{!isLoading && grouped.length > 0 && (
					<ul className="divide-y divide-border/50">
						{grouped.map((group) => (
							<SidebarEntry
								entry={group.entries[0]!}
								extraCount={group.entries.length - 1}
								key={group.key}
							/>
						))}
					</ul>
				)}

				<div className="border-t border-border/50 px-2 py-2.5">
					<Button
						className="h-auto w-full justify-start gap-1.5 px-2 py-1 text-xs font-medium text-primary hover:text-primary"
						onClick={onViewAll}
						variant="ghost"
					>
						View all activity
						<ArrowRight className="h-3.5 w-3.5" />
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

type Entry = RouterOutputs["auditLog"]["projectActivityFeed"]["entries"][number];

function SidebarEntry({ entry, extraCount }: { entry: Entry; extraCount: number }) {
	// Bold the actor name within the summary string
	const summaryParts = useMemo(() => {
		const actorName = entry.actor.name;
		const idx = entry.summary.indexOf(actorName);
		if (idx === -1) return { before: "", actor: "", after: entry.summary };
		return {
			before: entry.summary.slice(0, idx),
			actor: actorName,
			after: entry.summary.slice(idx + actorName.length),
		};
	}, [entry.summary, entry.actor.name]);

	return (
		<li className="flex items-start gap-2.5 px-2 py-2.5">
			<div className="shrink-0 mt-0.5">
				{entry.actor.type !== "system" ? (
					<UserAvatar
						avatarUrl={entry.actor.avatarUrl}
						name={entry.actor.name}
						size="xs"
					/>
				) : (
					<div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
						<span className="text-[10px] text-muted-foreground">S</span>
					</div>
				)}
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-xs leading-snug">
					{summaryParts.before}
					<span className="font-semibold">{summaryParts.actor}</span>
					{summaryParts.after}
				</p>
				<p className="mt-0.5 text-[11px] text-muted-foreground">
					{entry.relativeTime}
					{extraCount > 0 && (
						<span className="ml-1">+{extraCount} similar</span>
					)}
				</p>
			</div>
		</li>
	);
}
