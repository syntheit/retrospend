import { type ColumnDef, type VisibilityState } from "@tanstack/react-table";
import { format } from "date-fns";
import { MoreHorizontal, Trash2 } from "lucide-react";
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
): ColumnDef<ShadowProfile>[] {
	return [
		{
			accessorKey: "name",
			header: "Name",
			enableSorting: true,
			meta: { flex: true },
			cell: ({ row }) => (
				<span className="font-medium">{row.original.name}</span>
			),
		},
		{
			accessorKey: "email",
			header: "Email",
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
			header: "Status",
			enableSorting: true,
			size: 100,
			accessorFn: (row) => (row.claimedByUsername ? "Claimed" : "Unclaimed"),
			cell: ({ row }) =>
				row.original.claimedByUsername ? (
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<Badge className="border-transparent bg-emerald-500/10 text-emerald-500 shadow-none hover:bg-emerald-500/20">
									Claimed
								</Badge>
							</TooltipTrigger>
							<TooltipContent>
								Claimed by @{row.original.claimedByUsername}
								{row.original.claimedAt &&
									` on ${format(new Date(row.original.claimedAt), "MMM d, yyyy")}`}
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				) : (
					<Badge variant="secondary">Unclaimed</Badge>
				),
		},
		{
			accessorKey: "createdByUsername",
			header: "Created By",
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
			header: () => <div className="text-right">Projects</div>,
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
			header: () => <div className="text-right">Created</div>,
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
							<span className="sr-only">Actions</span>
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
							Delete Shadow Profile
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
): ColumnDef<GuestSession>[] {
	return [
		{
			accessorKey: "name",
			header: "Name",
			enableSorting: true,
			meta: { flex: true },
			cell: ({ row }) => (
				<span className="font-medium">{row.original.name}</span>
			),
		},
		{
			accessorKey: "email",
			header: "Email",
			enableSorting: true,
			meta: { flex: true },
			cell: ({ row }) => (
				<span className="text-muted-foreground">{row.original.email}</span>
			),
		},
		{
			accessorKey: "projectName",
			header: "Project",
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
			header: () => <div className="text-right">Last Active</div>,
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
			header: () => <div className="text-right">Created</div>,
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
							<span className="sr-only">Actions</span>
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
							Delete Guest Session
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
				toast.success(`Shadow profile "${pendingDelete.name}" has been deleted`);
				await refetchShadow();
			} else {
				await deleteGuestMutation.mutateAsync({ id: pendingDelete.id });
				toast.success(`Guest session "${pendingDelete.name}" has been deleted`);
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
			createShadowColumns((id, name) =>
				handleDelete({ type: "shadow", id, name }),
			),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[],
	);

	const guestColumns = useMemo(
		() =>
			createGuestColumns((id, name) =>
				handleDelete({ type: "guest", id, name }),
			),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[],
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
					Delete Shadow Profile
				</ContextMenuItem>
			</>
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

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
					Delete Guest Session
				</ContextMenuItem>
			</>
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

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
						? "Delete Shadow Profile"
						: "Delete Guest Session",
				description:
					pendingDelete.type === "shadow"
						? `Are you sure you want to delete the shadow profile "${pendingDelete.name}"? Their participation records will be anonymized. This action cannot be undone.`
						: `Are you sure you want to delete the guest session "${pendingDelete.name}"? Their participation records will be anonymized. This action cannot be undone.`,
				confirmLabel:
					pendingDelete.type === "shadow"
						? "Delete Shadow Profile"
						: "Delete Guest Session",
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
							Shadow Profiles
							{shadowProfiles && (
								<span className="ml-1.5 text-muted-foreground">
									({shadowProfiles.length})
								</span>
							)}
						</TabsTrigger>
						<TabsTrigger value="guest">
							Guest Sessions
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
						countNoun="shadow profiles"
						data={shadowProfiles ?? []}
						progressive
						renderContextMenu={renderShadowContextMenu}
						searchable
						searchPlaceholder="Search shadow profiles..."
					/>
				) : (
					<DataTable
						columns={guestColumns}
						columnVisibility={guestVisibility}
						countNoun="guest sessions"
						data={guestSessions ?? []}
						progressive
						renderContextMenu={renderGuestContextMenu}
						searchable
						searchPlaceholder="Search guest sessions..."
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
