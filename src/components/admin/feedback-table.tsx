"use client";

import {
	Archive,
	ChevronDown,
	Eye,
	EyeOff,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
} from "~/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "~/components/ui/collapsible";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { UserAvatar } from "~/components/ui/user-avatar";
import { getImageUrl } from "~/lib/image-url";
import { formatRelativeTime } from "~/lib/format";
import { cn } from "~/lib/utils";
import type { RouterOutputs } from "~/trpc/react";
import { api } from "~/trpc/react";

type FeedbackItem =
	RouterOutputs["feedback"]["list"]["items"][number];

type StatusFilter = "all" | "unread" | "read" | "archived";

export function FeedbackTable() {
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [deleteTarget, setDeleteTarget] = useState<FeedbackItem | null>(null);
	const utils = api.useUtils();

	const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
		api.feedback.list.useInfiniteQuery(
			{
				status: statusFilter === "all" ? undefined : statusFilter,
				limit: 20,
			},
			{
				getNextPageParam: (lastPage) => lastPage.nextCursor,
			},
		);

	const updateStatusMutation = api.feedback.updateStatus.useMutation({
		onSuccess: () => {
			void utils.feedback.list.invalidate();
			void utils.feedback.unreadCount.invalidate();
		},
		onError: (err) => toast.error(err.message),
	});

	const deleteMutation = api.feedback.delete.useMutation({
		onSuccess: () => {
			toast.success("Feedback deleted");
			setDeleteTarget(null);
			void utils.feedback.list.invalidate();
			void utils.feedback.unreadCount.invalidate();
		},
		onError: (err) => toast.error(err.message),
	});

	const items = data?.pages.flatMap((p) => p.items) ?? [];
	const counts = data?.pages[0]?.counts ?? {
		total: 0,
		unread: 0,
		read: 0,
		archived: 0,
	};

	const filters: { key: StatusFilter; label: string; count: number }[] = [
		{ key: "all", label: "All", count: counts.total },
		{ key: "unread", label: "Unread", count: counts.unread },
		{ key: "read", label: "Read", count: counts.read },
		{ key: "archived", label: "Archived", count: counts.archived },
	];

	return (
		<div className="space-y-4">
			<Tabs
				value={statusFilter}
				onValueChange={(v) => setStatusFilter(v as StatusFilter)}
			>
				<TabsList>
					{filters.map((f) => (
						<TabsTrigger key={f.key} value={f.key}>
							{f.label}
							<span className="ml-1 tabular-nums opacity-60">{f.count}</span>
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>

			{isLoading ? (
				<div className="space-y-3">
					{[1, 2, 3].map((i) => (
						<Skeleton className="h-32 w-full rounded-xl" key={i} />
					))}
				</div>
			) : items.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
					<p className="text-sm">No feedback entries found.</p>
				</div>
			) : (
				<div className="space-y-3">
					{items.map((item) => (
						<FeedbackCard
							item={item}
							key={item.id}
							onDelete={() => setDeleteTarget(item)}
							onStatusChange={(status) =>
								updateStatusMutation.mutate({ id: item.id, status })
							}
						/>
					))}
				</div>
			)}

			{hasNextPage && (
				<div className="flex justify-center pt-2">
					<Button
						disabled={isFetchingNextPage}
						onClick={() => fetchNextPage()}
						variant="outline"
					>
						{isFetchingNextPage ? "Loading..." : "Load More"}
					</Button>
				</div>
			)}

			<ConfirmationDialog
				confirmLabel="Delete"
				description="This will permanently delete this feedback entry. This action cannot be undone."
				isLoading={deleteMutation.isPending}
				onCancel={() => setDeleteTarget(null)}
				onConfirm={() => {
					if (deleteTarget) {
						deleteMutation.mutate({ id: deleteTarget.id });
					}
				}}
				onOpenChange={(open) => {
					if (!open) setDeleteTarget(null);
				}}
				open={!!deleteTarget}
				title="Delete Feedback"
				variant="destructive"
			/>
		</div>
	);
}

function FeedbackCard({
	item,
	onStatusChange,
	onDelete,
}: {
	item: FeedbackItem;
	onStatusChange: (status: "unread" | "read" | "archived") => void;
	onDelete: () => void;
}) {
	const avatarUrl = item.user.avatarPath
		? getImageUrl(item.user.avatarPath)
		: item.user.image;

	const statusBadge = {
		unread: <Badge className="bg-blue-500 text-white">Unread</Badge>,
		read: <Badge variant="secondary">Read</Badge>,
		archived: <Badge variant="outline">Archived</Badge>,
	}[item.status] ?? <Badge variant="outline">{item.status}</Badge>;

	return (
		<Card className={cn(item.status === "archived" && "opacity-60")}>
			<CardHeader className="pb-2">
				<div className="flex items-start justify-between gap-3">
					<div className="flex items-center gap-3">
						<UserAvatar
							avatarUrl={avatarUrl}
							name={item.user.name}
							size="sm"
						/>
						<div>
							<p className="font-medium text-sm leading-tight">
								{item.user.name}
							</p>
							<p className="text-muted-foreground text-xs">
								{item.user.email}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{statusBadge}
						<span className="text-muted-foreground text-xs">
							{formatRelativeTime(item.createdAt)}
						</span>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				<p className="whitespace-pre-wrap text-sm leading-relaxed">
					{item.message}
				</p>

				<Collapsible>
					<CollapsibleTrigger className="flex cursor-pointer items-center gap-1 text-muted-foreground text-xs hover:text-foreground">
						<ChevronDown className="h-3.5 w-3.5" />
						Details
					</CollapsibleTrigger>
					<CollapsibleContent>
						<div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-muted/50 p-3 text-xs">
							<div>
								<span className="text-muted-foreground">Page: </span>
								<span className="font-mono">{item.pageUrl}</span>
							</div>
							{item.appVersion && (
								<div>
									<span className="text-muted-foreground">Version: </span>
									<span className="font-mono">{item.appVersion}</span>
								</div>
							)}
							{item.viewportSize && (
								<div>
									<span className="text-muted-foreground">Viewport: </span>
									<span className="font-mono">{item.viewportSize}</span>
								</div>
							)}
							{item.userAgent && (
								<div className="col-span-2">
									<span className="text-muted-foreground">User Agent: </span>
									<span className="break-all font-mono">{item.userAgent}</span>
								</div>
							)}
						</div>
					</CollapsibleContent>
				</Collapsible>

				<Separator />
				<div className="flex items-center gap-1">
					{item.status === "unread" ? (
						<Button
							onClick={() => onStatusChange("read")}
							size="sm"
							variant="ghost"
						>
							<Eye />
							Mark Read
						</Button>
					) : (
						item.status !== "archived" && (
							<Button
								onClick={() => onStatusChange("unread")}
								size="sm"
								variant="ghost"
							>
								<EyeOff />
								Mark Unread
							</Button>
						)
					)}
					{item.status !== "archived" && (
						<Button
							onClick={() => onStatusChange("archived")}
							size="sm"
							variant="ghost"
						>
							<Archive />
							Archive
						</Button>
					)}
					{item.status === "archived" && (
						<Button
							onClick={() => onStatusChange("read")}
							size="sm"
							variant="ghost"
						>
							<Archive />
							Unarchive
						</Button>
					)}
					<div className="flex-1" />
					<Button
						className="text-destructive hover:text-destructive"
						onClick={onDelete}
						size="sm"
						variant="ghost"
					>
						<Trash2 />
						Delete
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
