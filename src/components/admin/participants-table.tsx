import { type ColumnDef, type VisibilityState } from "@tanstack/react-table";
import { format } from "date-fns";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "~/components/data-table";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	ContextMenuItem,
	ContextMenuSeparator,
} from "~/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { useIsMobile } from "~/hooks/use-mobile";
import { api } from "~/trpc/react";
import { ActionDialog } from "./action-dialog";

// Shadow profiles

interface ShadowProfile {
	id: string;
	name: string;
	email: string | null;
	createdByUsername: string;
	claimedByUsername: string | null;
	claimedAt: Date | null;
	createdAt: Date;
	projectCount: number;
}

function createShadowColumns(
	onDelete: (id: string, name: string) => void,
	t: ReturnType<typeof useTranslations<"admin">>,
): ColumnDef<ShadowProfile>[] {
	return [
		{
			accessorKey: "name",
			header: t("columnName"),
			enableSorting: true,
			meta: { flex: true },
			cell: ({ row }) => (
				<span className="font-medium">{row.original.name}</span>
			),
		},
		{
			accessorKey: "email",
			header: t("columnEmail"),
			enableSorting: true,
			meta: { flex: true },
			cell: ({ row }) => (
				<span className="text-muted-foreground">
					{row.original.email ?? "-"}
				</span>
			),
		},
		{
			id: "status",
			header: t("columnStatus"),
			enableSorting: true,
			size: 100,
			accessorFn: (row) => (row.claimedByUsername ? t("claimed") : t("unclaimed")),
			cell: ({ row }) =>
				row.original.claimedByUsername ? (
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<Badge className="border-transparent bg-emerald-500/10 text-emerald-500 shadow-none hover:bg-emerald-500/20">
									{t("claimed")}
								</Badge>
							</TooltipTrigger>
							<TooltipContent>
								{row.original.claimedAt
									? t("claimedByOn", {
											username: row.original.claimedByUsername,
											date: format(new Date(row.original.claimedAt), "MMM d, yyyy"),
										})
									: t("claimedBy", { username: row.original.claimedByUsername })}
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				) : (
					<Badge variant="secondary">{t("unclaimed")}</Badge>
				),
		},
		{
			accessorKey: "createdByUsername",
			header: t("columnCreatedBy"),
			enableSorting: true,
			size: 140,
			cell: ({ row }) => (
				<span className="text-muted-foreground">
					@{row.original.createdByUsername}
				</span>
			),
		},
		{
			accessorKey: "projectCount",
			header: () => <div className="text-right">{t("columnProjects")}</div>,
			enableSorting: true,
			size: 90,
			cell: ({ row }) => (
				<div className="text-right font-medium">
					{row.original.projectCount}
				</div>
			),
		},
		{
			accessorKey: "createdAt",
			header: () => <div className="text-right">{t("columnCreated")}</div>,
			enableSorting: true,
			size: 130,
			sortingFn: "datetime",
			cell: ({ row }) => (
				<div className="text-right text-muted-foreground text-sm">
					{format(new Date(row.original.createdAt), "MMM d, yyyy")}
				</div>
			),
		},
		{
			id: "actions",
			header: () => null,
			enableSorting: false,
			enableHiding: false,
			size: 48,
			cell: ({ row }) => (
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
					<DropdownMenuContent align="end" className="w-52">
						<DropdownMenuItem
							onClick={() =>
								onDelete(row.original.id, row.original.name)
							}
							variant="destructive"
						>
							<Trash2 className="mr-2 h-4 w-4" />
							{t("deleteShadowProfile")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			),
		},
	];
}

// Guest sessions

interface GuestSession {
	id: string;
	name: string;
	email: string;
	projectName: string;
	createdAt: Date;
	lastActiveAt: Date;
}

function createGuestColumns(
	onDelete: (id: string, name: string) => void,
	t: ReturnType<typeof useTranslations<"admin">>,
): ColumnDef<GuestSession>[] {
	return [
		{
			accessorKey: "name",
			header: t("columnName"),
			enableSorting: true,
			meta: { flex: true },
			cell: ({ row }) => (
				<span className="font-medium">{row.original.name}</span>
			),
		},
		{
			accessorKey: "email",
			header: t("columnEmail"),
			enableSorting: true,
			meta: { flex: true },
			cell: ({ row }) => (
				<span className="text-muted-foreground">{row.original.email}</span>
			),
		},
		{
			accessorKey: "projectName",
			header: t("columnProject"),
			enableSorting: true,
			size: 160,
			cell: ({ row }) => (
				<span className="text-muted-foreground">
					{row.original.projectName}
				</span>
			),
		},
		{
			accessorKey: "lastActiveAt",
			header: () => <div className="text-right">{t("columnLastActive")}</div>,
			enableSorting: true,
			size: 130,
			sortingFn: "datetime",
			cell: ({ row }) => (
				<div className="text-right text-muted-foreground text-sm">
					{format(new Date(row.original.lastActiveAt), "MMM d, yyyy")}
				</div>
			),
		},
		{
			accessorKey: "createdAt",
			header: () => <div className="text-right">{t("columnCreated")}</div>,
			enableSorting: true,
			size: 130,
			sortingFn: "datetime",
			cell: ({ row }) => (
				<div className="text-right text-muted-foreground text-sm">
					{format(new Date(row.original.createdAt), "MMM d, yyyy")}
				</div>
			),
		},
		{
			id: "actions",
			header: () => null,
			enableSorting: false,
			enableHiding: false,
			size: 48,
			cell: ({ row }) => (
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
					<DropdownMenuContent align="end" className="w-52">
						<DropdownMenuItem
							onClick={() =>
								onDelete(row.original.id, row.original.name)
							}
							variant="destructive"
						>
							<Trash2 className="mr-2 h-4 w-4" />
							{t("deleteGuestSession")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			),
		},
	];
}

// Combined table with toggle

type PendingDelete =
	| { type: "shadow"; id: string; name: string }
	| { type: "guest"; id: string; name: string }
	| null;

export function ParticipantsTable() {
	const t = useTranslations("admin");
	const [view, setView] = useState<"shadow" | "guest">("shadow");
	const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
	const isMobile = useIsMobile();

	const { data: shadowProfiles, refetch: refetchShadow } =
		api.admin.listShadowProfiles.useQuery(undefined, {
			enabled: view === "shadow",
		});
	const { data: guestSessions, refetch: refetchGuest } =
		api.admin.listGuestSessions.useQuery(undefined, {
			enabled: view === "guest",
		});

	const deleteShadowMutation = api.admin.deleteShadowProfile.useMutation();
	const deleteGuestMutation = api.admin.deleteGuestSession.useMutation();

	const handleDelete = (pending: PendingDelete) => {
		setPendingDelete(pending);
	};

	const handleConfirm = async () => {
		if (!pendingDelete) return;

		try {
			if (pendingDelete.type === "shadow") {
				await deleteShadowMutation.mutateAsync({ id: pendingDelete.id });
				toast.success(t("shadowProfileDeleted", { name: pendingDelete.name }));
				await refetchShadow();
			} else {
				await deleteGuestMutation.mutateAsync({ id: pendingDelete.id });
				toast.success(t("guestSessionDeleted", { name: pendingDelete.name }));
				await refetchGuest();
			}
			setPendingDelete(null);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "An error occurred";
			toast.error(message);
		}
	};

	const handleCancel = () => {
		setPendingDelete(null);
	};

	const handleDialogOpenChange = (open: boolean) => {
		if (!open) {
			setPendingDelete(null);
		}
	};

	const shadowColumns = useMemo(
		() =>
			createShadowColumns(
				(id, name) => handleDelete({ type: "shadow", id, name }),
				t,
			),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[t],
	);

	const guestColumns = useMemo(
		() =>
			createGuestColumns(
				(id, name) => handleDelete({ type: "guest", id, name }),
				t,
			),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[t],
	);

	const renderShadowContextMenu = useMemo(() => {
		return (profile: ShadowProfile) => (
			<>
				<ContextMenuSeparator className="first:hidden" />
				<ContextMenuItem
					onClick={() =>
						handleDelete({ type: "shadow", id: profile.id, name: profile.name })
					}
					variant="destructive"
				>
					<Trash2 className="mr-2 h-4 w-4" />
					{t("deleteShadowProfile")}
				</ContextMenuItem>
			</>
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [t]);

	const renderGuestContextMenu = useMemo(() => {
		return (guest: GuestSession) => (
			<>
				<ContextMenuSeparator className="first:hidden" />
				<ContextMenuItem
					onClick={() =>
						handleDelete({ type: "guest", id: guest.id, name: guest.name })
					}
					variant="destructive"
				>
					<Trash2 className="mr-2 h-4 w-4" />
					{t("deleteGuestSession")}
				</ContextMenuItem>
			</>
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [t]);

	const shadowVisibility: VisibilityState = isMobile
		? { projectCount: false, createdAt: false }
		: {};

	const guestVisibility: VisibilityState = isMobile
		? { createdAt: false }
		: {};

	const isLoading =
		deleteShadowMutation.isPending || deleteGuestMutation.isPending;

	const dialogContent = pendingDelete
		? {
				title:
					pendingDelete.type === "shadow"
						? t("deleteShadowProfile")
						: t("deleteGuestSession"),
				description:
					pendingDelete.type === "shadow"
						? t("deleteShadowProfileConfirm", { name: pendingDelete.name })
						: t("deleteGuestSessionConfirm", { name: pendingDelete.name }),
				confirmLabel:
					pendingDelete.type === "shadow"
						? t("deleteShadowProfile")
						: t("deleteGuestSession"),
				variant: "destructive" as const,
			}
		: null;

	return (
		<>
			<div className="space-y-4">
				<Tabs
					onValueChange={(v) => setView(v as "shadow" | "guest")}
					value={view}
				>
					<TabsList>
						<TabsTrigger value="shadow">
							{t("shadowProfiles")}
							{shadowProfiles && (
								<span className="ml-1.5 text-muted-foreground">
									({shadowProfiles.length})
								</span>
							)}
						</TabsTrigger>
						<TabsTrigger value="guest">
							{t("guestSessions")}
							{guestSessions && (
								<span className="ml-1.5 text-muted-foreground">
									({guestSessions.length})
								</span>
							)}
						</TabsTrigger>
					</TabsList>
				</Tabs>

				{view === "shadow" ? (
					<DataTable
						columns={shadowColumns}
						columnVisibility={shadowVisibility}
						countNoun={t("shadowProfilesNoun")}
						data={shadowProfiles ?? []}
						progressive
						renderContextMenu={renderShadowContextMenu}
						searchable
						searchPlaceholder={t("searchShadowProfiles")}
					/>
				) : (
					<DataTable
						columns={guestColumns}
						columnVisibility={guestVisibility}
						countNoun={t("guestSessionsNoun")}
						data={guestSessions ?? []}
						progressive
						renderContextMenu={renderGuestContextMenu}
						searchable
						searchPlaceholder={t("searchGuestSessions")}
					/>
				)}
			</div>

			{dialogContent && (
				<ActionDialog
					confirmLabel={dialogContent.confirmLabel}
					description={dialogContent.description}
					isLoading={isLoading}
					onCancel={handleCancel}
					onConfirm={handleConfirm}
					onOpenChange={handleDialogOpenChange}
					open={pendingDelete !== null}
					title={dialogContent.title}
					variant={dialogContent.variant}
				/>
			)}
		</>
	);
}
