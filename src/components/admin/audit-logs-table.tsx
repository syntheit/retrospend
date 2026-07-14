"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { ClipboardCopy, Eye, Info, MoreHorizontal, ScrollText, User } from "lucide-react";
import { useTranslations } from "next-intl";
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

function getEventTypeLabels(t: ReturnType<typeof useTranslations<"auditLog">>): Record<EventType, string> {
	return {
		FAILED_LOGIN: t("eventFailedLogin"),
		SUCCESSFUL_LOGIN: t("eventSuccessfulLogin"),
		PASSWORD_RESET: t("eventPasswordReset"),
		PASSWORD_CHANGED: t("eventPasswordChanged"),
		ACCOUNT_CREATED: t("eventAccountCreated"),
		ACCOUNT_DELETED: t("eventAccountDeleted"),
		ACCOUNT_ENABLED: t("eventAccountEnabled"),
		ACCOUNT_DISABLED: t("eventAccountDisabled"),
		INVITE_USED: t("eventInviteUsed"),
		INVITE_CREATED: t("eventInviteCreated"),
		EMAIL_VERIFIED: t("eventEmailVerified"),
		TWO_FACTOR_ENABLED: t("event2FAEnabled"),
		TWO_FACTOR_DISABLED: t("event2FADisabled"),
		SETTINGS_UPDATED: t("eventSettingsUpdated"),
		USER_UPDATED: t("eventUserUpdated"),
		USERNAME_CHANGED: t("eventUsernameChanged"),
		EXPENSE_IMPORT: t("eventExpenseImport"),
		ADMIN_RESET_LINK_GENERATED: t("eventAdminResetLink"),
		ADMIN_AI_ACCESS_CHANGED: t("eventAiAccessChanged"),
		EMAIL_CHANGE_REQUESTED: t("eventEmailChangeRequested"),
		EMAIL_CHANGE_CONFIRMED: t("eventEmailChangeConfirmed"),
		EMAIL_CHANGE_REVERTED: t("eventEmailChangeReverted"),
		GUEST_UPGRADED: t("eventGuestUpgraded"),
		ADMIN_DELETE_SHADOW_PROFILE: t("eventShadowProfileDeleted"),
		ADMIN_DELETE_GUEST_SESSION: t("eventGuestSessionDeleted"),
	};
}

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

function getPrivacyModeConfig(t: ReturnType<typeof useTranslations<"auditLog">>): Record<PrivacyMode, { label: string; description: string }> {
	return {
		minimal: { label: t("privacyMinimal"), description: t("privacyMinimalDesc") },
		anonymized: { label: t("privacyAnonymized"), description: t("privacyAnonymizedDesc") },
		full: { label: t("privacyFull"), description: t("privacyFullDesc") },
	};
}

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
	const t = useTranslations("auditLog");
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>{t("eventDetails")}</DialogTitle>
					<DialogDescription>{t("metadataFor", { eventType })}</DialogDescription>
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
	const t = useTranslations("auditLog");
	const EVENT_TYPE_LABELS = useMemo(() => getEventTypeLabels(t), [t]);
	const PRIVACY_MODE_CONFIG = useMemo(() => getPrivacyModeConfig(t), [t]);
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
			header: t("columnDateTime"),
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
			header: t("columnEventType"),
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
			header: t("columnUser"),
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
								: t("na")}
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
			header: t("columnIpAddress"),
			enableSorting: false,
			cell: ({ row }) => {
				const ip = row.original.ipAddress;
				return (
					<span className="font-mono text-sm">
						{ip || <span className="text-muted-foreground">{t("na")}</span>}
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
								<span className="sr-only">{t("actions")}</span>
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
									{t("viewDetails")}
								</DropdownMenuItem>
							)}
							{hasIp && (
								<DropdownMenuItem
									onClick={() => {
										void navigator.clipboard.writeText(row.original.ipAddress!);
										toast.success(t("ipCopied"));
									}}
								>
									<ClipboardCopy className="mr-2 h-4 w-4" />
									{t("copyIp")}
								</DropdownMenuItem>
							)}
							{hasUser && (
								<DropdownMenuItem
									onClick={() => {
										void navigator.clipboard.writeText(row.original.user!.id);
										toast.success(t("userIdCopied"));
									}}
								>
									<User className="mr-2 h-4 w-4" />
									{t("copyUserId")}
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				);
			},
		},
	// eslint-disable-next-line react-hooks/exhaustive-deps
	], [t, EVENT_TYPE_LABELS]);

	const columnVisibility: Record<string, boolean> = isMobile
		? { ipAddress: false, actions: false }
		: {};

	const eventTypes: Array<{ value: EventType | "all"; label: string }> = [
		{ value: "all", label: t("allEvents") },
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
						<h2 className="font-semibold text-xl tracking-tight">{t("title")}</h2>
						<div className="flex items-center gap-3">
							<p className="text-muted-foreground text-sm">
								{t("description")}
							</p>
							<div className="flex items-center gap-1.5 text-muted-foreground text-sm">
								<span>{t("logLevel", { level: privacyConfig.label })}</span>
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
							<SelectValue placeholder={t("filterByEventType")} />
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
						{t("loading")}
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
						countNoun={t("events")}
						emptyState={
							<EmptyState
								icon={ScrollText}
								title={t("noEventsFound")}
								description={
									eventTypeFilter !== "all"
										? t("noEventsOfType", { type: EVENT_TYPE_LABELS[eventTypeFilter] })
										: t("noAuditEventsYet")
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
									{t("viewDetails")}
								</ContextMenuItem>
								{row.ipAddress && (
									<ContextMenuItem
										onClick={() => {
											void navigator.clipboard.writeText(row.ipAddress!);
											toast.success(t("ipCopied"));
										}}
									>
										<ClipboardCopy className="mr-2 h-4 w-4" />
										{t("copyIp")}
									</ContextMenuItem>
								)}
								{row.user && (
									<ContextMenuItem
										onClick={() => {
											void navigator.clipboard.writeText(row.user!.id);
											toast.success(t("userIdCopied"));
										}}
									>
										<User className="mr-2 h-4 w-4" />
										{t("copyUserId")}
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
