"use client";

import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { ChevronDown, Eye, Info } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { api } from "~/trpc/react";
import type { EventType } from "~prisma";

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
	EXPENSE_IMPORT: "Expense Import",
};

const EVENT_TYPE_COLORS: Record<EventType, string> = {
	FAILED_LOGIN: "text-red-600",
	SUCCESSFUL_LOGIN: "text-green-600",
	PASSWORD_RESET: "text-orange-600",
	PASSWORD_CHANGED: "text-blue-600",
	ACCOUNT_CREATED: "text-green-600",
	ACCOUNT_DELETED: "text-red-600",
	ACCOUNT_ENABLED: "text-green-600",
	ACCOUNT_DISABLED: "text-orange-600",
	INVITE_USED: "text-blue-600",
	INVITE_CREATED: "text-blue-600",
	EMAIL_VERIFIED: "text-green-600",
	TWO_FACTOR_ENABLED: "text-blue-600",
	TWO_FACTOR_DISABLED: "text-orange-600",
	SETTINGS_UPDATED: "text-blue-600",
	USER_UPDATED: "text-blue-600",
	EXPENSE_IMPORT: "text-purple-600",
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
		<Dialog open={open} onOpenChange={onOpenChange}>
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
	const [eventTypeFilter, setEventTypeFilter] = useState<EventType | "all">(
		"all",
	);
	const [selectedMetadata, setSelectedMetadata] = useState<{
		data: unknown;
		eventType: string;
	} | null>(null);
	const [page, setPage] = useState(1);
	const pageSize = 50;

	const { data, isLoading } = api.admin.getEventLogs.useQuery({
		limit: pageSize,
		offset: (page - 1) * pageSize,
		eventType: eventTypeFilter === "all" ? undefined : eventTypeFilter,
	});

	const { data: privacyModeData } = api.admin.getAuditLogPrivacyMode.useQuery();

	const columns: ColumnDef<EventLog>[] = [
		{
			accessorKey: "timestamp",
			header: "Date & Time",
			cell: ({ row }) => {
				const date = new Date(row.original.timestamp);
				return (
					<div className="space-y-0.5">
						<div className="font-medium text-sm">
							{date.toLocaleDateString()}
						</div>
						<div className="text-muted-foreground text-xs">
							{date.toLocaleTimeString()}
						</div>
					</div>
				);
			},
		},
		{
			accessorKey: "eventType",
			header: "Event Type",
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
			header: "Details",
			cell: ({ row }) => {
				const hasMetadata = row.original.metadata !== null;
				return (
					<Button
						disabled={!hasMetadata}
						onClick={() =>
							setSelectedMetadata({
								data: row.original.metadata,
								eventType: EVENT_TYPE_LABELS[row.original.eventType],
							})
						}
						size="sm"
						variant="ghost"
					>
						<Eye className="mr-2 h-4 w-4" />
						View
					</Button>
				);
			},
		},
	];

	const table = useReactTable({
		data: data?.logs ?? [],
		columns,
		getCoreRowModel: getCoreRowModel(),
	});

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
						value={eventTypeFilter ?? "all"}
						onValueChange={(value) => {
							setEventTypeFilter(value as EventType | "all");
							setPage(1);
						}}
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

				<Card>
					<CardHeader>
						<CardTitle>Event Log</CardTitle>
						<CardDescription>
							{data?.total ?? 0} total events
							{eventTypeFilter !== "all" &&
								` (filtered by ${EVENT_TYPE_LABELS[eventTypeFilter]})`}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="rounded-md border">
							<Table>
								<TableHeader>
									{table.getHeaderGroups().map((headerGroup) => (
										<TableRow key={headerGroup.id}>
											{headerGroup.headers.map((header) => (
												<TableHead key={header.id}>
													{header.isPlaceholder
														? null
														: flexRender(
																header.column.columnDef.header,
																header.getContext(),
															)}
												</TableHead>
											))}
										</TableRow>
									))}
								</TableHeader>
								<TableBody>
									{isLoading ? (
										<TableRow>
											<TableCell
												colSpan={columns.length}
												className="h-24 text-center"
											>
												Loading...
											</TableCell>
										</TableRow>
									) : table.getRowModel().rows?.length ? (
										table.getRowModel().rows.map((row) => (
											<TableRow key={row.id}>
												{row.getVisibleCells().map((cell) => (
													<TableCell key={cell.id}>
														{flexRender(
															cell.column.columnDef.cell,
															cell.getContext(),
														)}
													</TableCell>
												))}
											</TableRow>
										))
									) : (
										<TableRow>
											<TableCell
												colSpan={columns.length}
												className="h-24 text-center"
											>
												No events found.
											</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
						</div>

						{data && data.total > pageSize && (
							<div className="flex items-center justify-between pt-4">
								<div className="text-muted-foreground text-sm">
									Showing {(page - 1) * pageSize + 1} to{" "}
									{Math.min(page * pageSize, data.total)} of {data.total} events
								</div>
								<div className="flex gap-2">
									<Button
										disabled={page === 1}
										onClick={() => setPage(page - 1)}
										size="sm"
										variant="outline"
									>
										Previous
									</Button>
									<Button
										disabled={!data.hasMore}
										onClick={() => setPage(page + 1)}
										size="sm"
										variant="outline"
									>
										Next
									</Button>
								</div>
							</div>
						)}
					</CardContent>
				</Card>
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
