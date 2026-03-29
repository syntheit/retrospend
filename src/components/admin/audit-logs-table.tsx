"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { ClipboardCopy, Eye, Info, MoreHorizontal, ScrollText, User } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ContextMenuItem } from "~/components/ui/context-menu";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { useIsMobile } from "~/hooks/use-mobile";
import { api } from "~/trpc/react";
import type { EventType } from "~prisma";
import { Button } from "~/components/ui/button";
import { DataTable } from "~/components/data-table";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { EmptyState } from "~/components/ui/empty-state";

interface EventLog {
	id: string;
	timestamp: Date;
	eventType: EventType;
	userId: string | null;
	ipAddress: string | null;
	userAgent: string | null;
	metadata: unknown;
	user: {
		id: string;
		username: string;
		email: string;
	} | null;
}

const EVENT_TYPE_LABELS: Record<EventType, string> = {
	FAILED_LOGIN: "Failed Login",
	SUCCESSFUL_LOGIN: "Successful Login",
	PASSWORD_RESET: "Password Reset",
	PASSWORD_CHANGED: "Password Changed",
	ACCOUNT_CREATED: "Account Created",
	ACCOUNT_DELETED: "Account Deleted",
	ACCOUNT_ENABLED: "Account Enabled",
	ACCOUNT_DISABLED: "Account Disabled",
	INVITE_USED: "Invite Used",
	INVITE_CREATED: "Invite Created",
	EMAIL_VERIFIED: "Email Verified",
	TWO_FACTOR_ENABLED: "2FA Enabled",
	TWO_FACTOR_DISABLED: "2FA Disabled",
	SETTINGS_UPDATED: "Settings Updated",
	USER_UPDATED: "User Updated",
	USERNAME_CHANGED: "Username Changed",
	EXPENSE_IMPORT: "Expense Import",
	ADMIN_RESET_LINK_GENERATED: "Admin Reset Link",
	ADMIN_AI_ACCESS_CHANGED: "AI Access Changed",
	EMAIL_CHANGE_REQUESTED: "Email Change Requested",
	EMAIL_CHANGE_CONFIRMED: "Email Change Confirmed",
	EMAIL_CHANGE_REVERTED: "Email Change Reverted",
	GUEST_UPGRADED: "Guest Upgraded",
	ADMIN_DELETE_SHADOW_PROFILE: "Shadow Profile Deleted",
	ADMIN_DELETE_GUEST_SESSION: "Guest Session Deleted",
};

const EVENT_TYPE_COLORS: Record<EventType, string> = {
	FAILED_LOGIN: "text-destructive",
	SUCCESSFUL_LOGIN: "text-emerald-500",
	PASSWORD_RESET: "text-warning",
	PASSWORD_CHANGED: "text-blue-500",
	ACCOUNT_CREATED: "text-emerald-500",
	ACCOUNT_DELETED: "text-destructive",
	ACCOUNT_ENABLED: "text-emerald-500",
	ACCOUNT_DISABLED: "text-warning",
	INVITE_USED: "text-blue-500",
	INVITE_CREATED: "text-blue-500",
	EMAIL_VERIFIED: "text-emerald-500",
	TWO_FACTOR_ENABLED: "text-blue-500",
	TWO_FACTOR_DISABLED: "text-warning",
	SETTINGS_UPDATED: "text-blue-500",
	USER_UPDATED: "text-blue-500",
	USERNAME_CHANGED: "text-blue-500",
	EXPENSE_IMPORT: "text-purple-500",
	ADMIN_RESET_LINK_GENERATED: "text-warning",
	ADMIN_AI_ACCESS_CHANGED: "text-blue-500",
	EMAIL_CHANGE_REQUESTED: "text-warning",
	EMAIL_CHANGE_CONFIRMED: "text-emerald-500",
	EMAIL_CHANGE_REVERTED: "text-destructive",
	GUEST_UPGRADED: "text-emerald-500",
	ADMIN_DELETE_SHADOW_PROFILE: "text-destructive",
	ADMIN_DELETE_GUEST_SESSION: "text-destructive",
};

type PrivacyMode = "minimal" | "anonymized" | "full";

const PRIVACY_MODE_CONFIG: Record<
	PrivacyMode,
	{
		label: string;
		description: string;
	}
> = {
	minimal: {
		label: "Minimal",
		description: "No IP addresses or user agents are stored",
	},
	anonymized: {
		label: "Anonymized",
		description: "IP addresses are anonymized (last octet removed)",
	},
	full: {
		label: "Full",
		description: "Complete IP addresses and user agents are stored",
	},
};

interface MetadataDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	metadata: unknown;
	eventType: string;
}

function MetadataDialog({
	open,
	onOpenChange,
	metadata,
	eventType,
}: MetadataDialogProps) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Event Details</DialogTitle>
					<DialogDescription>Metadata for {eventType} event</DialogDescription>
				</DialogHeader>
				<div className="max-h-[60vh] overflow-auto">
					<pre className="rounded-md bg-muted p-4 text-xs">
						{JSON.stringify(metadata, null, 2)}
					</pre>
				</div>
			</DialogContent>
		</Dialog>
	);
}

export function AuditLogsTable() {
	const isMobile = useIsMobile();
	const [eventTypeFilter, setEventTypeFilter] = useState<EventType | "all">(
		"all",
	);
	const [selectedMetadata, setSelectedMetadata] = useState<{
		data: unknown;
		eventType: string;
	} | null>(null);

	const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
		api.admin.getEventLogsCursor.useInfiniteQuery(
			{
				limit: 50,
				eventType: eventTypeFilter === "all" ? undefined : eventTypeFilter,
			},
			{
				getNextPageParam: (lastPage) => lastPage.nextCursor,
			},
		);

	const { data: privacyModeData } = api.admin.getAuditLogPrivacyMode.useQuery();

	const allLogs = useMemo(
		() => data?.pages.flatMap((p) => p.logs) ?? [],
		[data],
	);

	const columns = useMemo<ColumnDef<EventLog>[]>(() => [
		{
			accessorKey: "timestamp",
			header: "Date & Time",
			enableSorting: true,
			cell: ({ row }) => {
				const date = new Date(row.original.timestamp);
				return (
					<div className="space-y-0.5">
						<div className="font-medium text-sm">
							{format(date, "MMM d, yyyy")}
						</div>
						<div className="text-muted-foreground text-xs">
							{format(date, "h:mm a")}
						</div>
					</div>
				);
			},
		},
		{
			accessorKey: "eventType",
			header: "Event Type",
			enableSorting: true,
			cell: ({ row }) => {
				const eventType = row.original.eventType;
				return (
					<span className={`font-medium ${EVENT_TYPE_COLORS[eventType]}`}>
						{EVENT_TYPE_LABELS[eventType]}
					</span>
				);
			},
		},
		{
			accessorKey: "user",
			header: "User",
			enableSorting: true,
			sortingFn: (rowA, rowB) => {
				const a = rowA.original.user?.username ?? "";
				const b = rowB.original.user?.username ?? "";
				return a.localeCompare(b);
			},
			cell: ({ row }) => {
				const user = row.original.user;
				if (!user) {
					return (
						<span className="text-muted-foreground text-sm">
							{row.original.userId
								? `ID: ${row.original.userId.slice(0, 8)}...`
								: "N/A"}
						</span>
					);
				}
				return (
					<div className="space-y-0.5">
						<div className="font-medium text-sm">@{user.username}</div>
						<div className="text-muted-foreground text-xs">{user.email}</div>
					</div>
				);
			},
		},
		{
			accessorKey: "ipAddress",
			header: "IP Address",
			enableSorting: false,
			cell: ({ row }) => {
				const ip = row.original.ipAddress;
				return (
					<span className="font-mono text-sm">
						{ip || <span className="text-muted-foreground">N/A</span>}
					</span>
				);
			},
		},
		{
			id: "actions",
			header: () => null,
			enableSorting: false,
			enableHiding: false,
			size: 48,
			cell: ({ row }) => {
				const hasMetadata = row.original.metadata !== null;
				const hasIp = !!row.original.ipAddress;
				const hasUser = !!row.original.user;
				if (!hasMetadata && !hasIp && !hasUser) return null;
				return (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								className="h-7 w-7 md:opacity-0 transition-opacity md:group-hover:opacity-100"
								size="icon"
								variant="ghost"
							>
								<MoreHorizontal className="h-4 w-4" />
								<span className="sr-only">Actions</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-44">
							{hasMetadata && (
								<DropdownMenuItem
									onClick={() =>
										setSelectedMetadata({
											data: row.original.metadata,
											eventType: EVENT_TYPE_LABELS[row.original.eventType],
										})
									}
								>
									<Eye className="mr-2 h-4 w-4" />
									View Details
								</DropdownMenuItem>
							)}
							{hasIp && (
								<DropdownMenuItem
									onClick={() => {
										void navigator.clipboard.writeText(row.original.ipAddress!);
										toast.success("IP address copied");
									}}
								>
									<ClipboardCopy className="mr-2 h-4 w-4" />
									Copy IP
								</DropdownMenuItem>
							)}
							{hasUser && (
								<DropdownMenuItem
									onClick={() => {
										void navigator.clipboard.writeText(row.original.user!.id);
										toast.success("User ID copied");
									}}
								>
									<User className="mr-2 h-4 w-4" />
									Copy User ID
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				);
			},
		},
	// eslint-disable-next-line react-hooks/exhaustive-deps
	], []);

	const columnVisibility: Record<string, boolean> = isMobile
		? { ipAddress: false, actions: false }
		: {};

	const eventTypes: Array<{ value: EventType | "all"; label: string }> = [
		{ value: "all", label: "All Events" },
		...Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => ({
			value: value as EventType,
			label,
		})),
	];

	const privacyMode = (privacyModeData?.mode || "minimal") as PrivacyMode;
	const privacyConfig = PRIVACY_MODE_CONFIG[privacyMode];

	return (
		<>
			<div className="space-y-4">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="font-semibold text-xl tracking-tight">Audit Logs</h2>
						<div className="flex items-center gap-3">
							<p className="text-muted-foreground text-sm">
								Track security events and administrative actions.
							</p>
							<div className="flex items-center gap-1.5 text-muted-foreground text-sm">
								<span>Log Level: {privacyConfig.label}</span>
								<TooltipProvider>
									<Tooltip>
										<TooltipTrigger asChild>
											<Info className="h-3.5 w-3.5 cursor-help" />
										</TooltipTrigger>
										<TooltipContent>
											<p className="text-xs">{privacyConfig.description}</p>
										</TooltipContent>
									</Tooltip>
								</TooltipProvider>
							</div>
						</div>
					</div>
					<Select
						onValueChange={(value) => {
							setEventTypeFilter(value as EventType | "all");
						}}
						value={eventTypeFilter ?? "all"}
					>
						<SelectTrigger className="w-[200px]">
							<SelectValue placeholder="Filter by event type" />
						</SelectTrigger>
						<SelectContent>
							{eventTypes.map((type) => (
								<SelectItem key={type.value} value={type.value ?? "all"}>
									{type.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{isLoading ? (
					<div className="flex items-center justify-center rounded-xl border py-16 text-muted-foreground text-sm">
						Loading...
					</div>
				) : (
					<DataTable
						data={allLogs}
						columns={columns}
						progressive
						onReachEnd={() => {
							if (hasNextPage && !isFetchingNextPage) fetchNextPage();
						}}
						searchable={false}
						columnVisibility={columnVisibility}
						countNoun="events"
						emptyState={
							<EmptyState
								icon={ScrollText}
								title="No events found"
								description={
									eventTypeFilter !== "all"
										? `No ${EVENT_TYPE_LABELS[eventTypeFilter]} events recorded.`
										: "No audit events have been recorded yet."
								}
							/>
						}
						renderContextMenu={(row) => (
							<>
								<ContextMenuItem
									onClick={() => {
										if (row.metadata !== null) {
											setSelectedMetadata({
												data: row.metadata,
												eventType: EVENT_TYPE_LABELS[row.eventType],
											});
										}
									}}
									disabled={row.metadata === null}
								>
									<Eye className="mr-2 h-4 w-4" />
									View Details
								</ContextMenuItem>
								{row.ipAddress && (
									<ContextMenuItem
										onClick={() => {
											void navigator.clipboard.writeText(row.ipAddress!);
											toast.success("IP address copied");
										}}
									>
										<ClipboardCopy className="mr-2 h-4 w-4" />
										Copy IP
									</ContextMenuItem>
								)}
								{row.user && (
									<ContextMenuItem
										onClick={() => {
											void navigator.clipboard.writeText(row.user!.id);
											toast.success("User ID copied");
										}}
									>
										<User className="mr-2 h-4 w-4" />
										Copy User ID
									</ContextMenuItem>
								)}
							</>
						)}
					/>
				)}
			</div>

			{selectedMetadata && (
				<MetadataDialog
					eventType={selectedMetadata.eventType}
					metadata={selectedMetadata.data}
					onOpenChange={(open) => !open && setSelectedMetadata(null)}
					open={!!selectedMetadata}
				/>
			)}
		</>
	);
}
