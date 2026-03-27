import { type ColumnDef, type VisibilityState } from "@tanstack/react-table";
import { format } from "date-fns";
import { Copy, Link, MoreHorizontal, Trash2 } from "lucide-react";
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
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { useIsMobile } from "~/hooks/use-mobile";
import { api } from "~/trpc/react";

interface InviteCode {
	id: string;
	code: string;
	isActive: boolean;
	usedAt: Date | null;
	expiresAt: Date | null;
	createdAt: Date;
	createdBy: {
		username: string;
		name: string;
	};
	usedBy: {
		username: string;
		name: string;
	} | null;
	status: string;
}

interface InviteCodesTableProps {
	inviteCodes: InviteCode[];
	isLoading: boolean;
	status: "active" | "used";
	onStatusChange: (status: "active" | "used") => void;
	onGenerateCode: () => void;
	onDeleteCode: (inviteCodeId: string, code: string) => void;
}

function createColumns(
	onDeleteCode: (inviteCodeId: string, code: string) => void,
): ColumnDef<InviteCode>[] {
	return [
	{
		accessorKey: "code",
		header: "Code",
		enableSorting: true,
		cell: ({ row }) => (
			<div className="flex items-center gap-2 font-medium font-mono">
				<span>{row.original.code}</span>
				<CopyButton
					label="Copy Code"
					successLabel="Code Copied"
					value={row.original.code}
				/>
				<CopyButton
					icon={Link}
					label="Copy Link"
					successLabel="Link Copied"
					value={`${window.location.origin}/signup?code=${row.original.code}`}
				/>
			</div>
		),
	},
	{
		accessorKey: "status",
		header: "Status",
		enableSorting: true,
		cell: ({ row }) => (
			<Badge
				variant={row.original.status === "Active" ? "default" : "secondary"}
			>
				{row.original.status}
			</Badge>
		),
	},
	{
		id: "createdBy",
		header: "Created By",
		enableSorting: true,
		sortingFn: (rowA, rowB) => {
			const a = rowA.original.createdBy.username;
			const b = rowB.original.createdBy.username;
			return a.localeCompare(b);
		},
		cell: ({ row }) => (
			<div className="flex flex-col">
				<span className="font-medium">
					@{row.original.createdBy.username}
				</span>
				<span className="text-muted-foreground text-sm">
					{row.original.createdBy.name}
				</span>
			</div>
		),
	},
	{
		accessorKey: "createdAt",
		header: "Created At",
		enableSorting: true,
		cell: ({ row }) =>
			format(new Date(row.original.createdAt), "MMM d, yyyy HH:mm"),
	},
	{
		id: "usedBy",
		header: "Used By",
		enableSorting: true,
		sortingFn: (rowA, rowB) => {
			const a = rowA.original.usedBy?.username ?? "";
			const b = rowB.original.usedBy?.username ?? "";
			return a.localeCompare(b);
		},
		cell: ({ row }) =>
			row.original.usedBy ? (
				<div className="flex flex-col">
					<span className="font-medium">
						@{row.original.usedBy.username}
					</span>
					<span className="text-muted-foreground text-sm">
						{row.original.usedBy.name}
					</span>
				</div>
			) : (
				<span className="text-muted-foreground">-</span>
			),
	},
	{
		accessorKey: "usedAt",
		header: "Used At",
		enableSorting: true,
		cell: ({ row }) =>
			row.original.usedAt ? (
				format(new Date(row.original.usedAt), "MMM d, yyyy HH:mm")
			) : (
				<span className="text-muted-foreground">-</span>
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
				<DropdownMenuContent align="end" className="w-44">
					<DropdownMenuItem
						onClick={() => {
							void navigator.clipboard.writeText(row.original.code);
							toast.success("Code copied to clipboard");
						}}
					>
						<Copy className="mr-2 h-4 w-4" />
						Copy Code
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => {
							void navigator.clipboard.writeText(
								`${window.location.origin}/signup?code=${row.original.code}`,
							);
							toast.success("Signup link copied");
						}}
					>
						<Link className="mr-2 h-4 w-4" />
						Copy Signup Link
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => onDeleteCode(row.original.id, row.original.code)}
						variant="destructive"
					>
						<Trash2 className="mr-2 h-4 w-4" />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		),
	},
	];
}

export function InviteCodesTable({
	inviteCodes,
	isLoading,
	status,
	onStatusChange,
	onGenerateCode,
	onDeleteCode,
}: InviteCodesTableProps) {
	const generateMutation = api.invite.generate.useMutation();
	const isMobile = useIsMobile();

	const handleGenerateCode = async () => {
		try {
			const result = await generateMutation.mutateAsync();
			toast.success(`New invite code generated: ${result.code}`);
			onGenerateCode();
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Failed to generate invite code";
			toast.error(message);
		}
	};

	const columns = useMemo(
		() => createColumns(onDeleteCode),
		[onDeleteCode],
	);

	const columnVisibility: VisibilityState = isMobile
		? { createdBy: false, usedBy: false, usedAt: false }
		: {};

	const renderContextMenu = useMemo(() => (inviteCode: InviteCode) => (
		<>
			<ContextMenuItem
				onClick={() => {
					void navigator.clipboard.writeText(inviteCode.code);
					toast.success("Code copied to clipboard");
				}}
			>
				<Copy className="mr-2 h-4 w-4" />
				Copy Code
			</ContextMenuItem>
			<ContextMenuItem
				onClick={() => {
					void navigator.clipboard.writeText(
						`${window.location.origin}/signup?code=${inviteCode.code}`,
					);
					toast.success("Signup link copied to clipboard");
				}}
			>
				<Link className="mr-2 h-4 w-4" />
				Copy Signup Link
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem
				onClick={() => onDeleteCode(inviteCode.id, inviteCode.code)}
				variant="destructive"
			>
				<Trash2 className="mr-2 h-4 w-4" />
				Delete
			</ContextMenuItem>
		</>
	), [onDeleteCode]);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="font-medium text-lg">Invite Codes</h3>
					<p className="text-muted-foreground text-sm">
						Manage invite codes for new user registrations.
					</p>
				</div>
				{status === "active" && (
					<Button
						disabled={generateMutation.isPending || isLoading}
						onClick={handleGenerateCode}
					>
						{generateMutation.isPending ? "Generating..." : "Generate New Code"}
					</Button>
				)}
			</div>

			<Tabs
				onValueChange={(value) => onStatusChange(value as "active" | "used")}
				value={status}
			>
				<TabsList className="mb-4">
					<TabsTrigger value="active">Active</TabsTrigger>
					<TabsTrigger value="used">Used</TabsTrigger>
				</TabsList>

				<DataTable
					columns={columns}
					columnVisibility={columnVisibility}
					data={inviteCodes}
					emptyState={
						<div className="py-8 text-muted-foreground text-sm">
							{status === "active"
								? "No active invite codes found. Generate your first code to get started."
								: "No used invite codes found."}
						</div>
					}
					progressive
					renderContextMenu={renderContextMenu}
					searchable
					searchPlaceholder="Search invite codes..."
				/>
			</Tabs>
		</div>
	);
}

function CopyButton({
	value,
	label,
	successLabel,
	icon: Icon = Copy,
}: {
	value: string;
	label: string;
	successLabel: string;
	icon?: React.ElementType;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [hasCopied, setHasCopied] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			setHasCopied(true);
			setIsOpen(true);
			toast.success(successLabel);
			setTimeout(() => {
				setHasCopied(false);
				setIsOpen(false);
			}, 2000);
		} catch {
			toast.error("Failed to copy to clipboard");
		}
	};

	return (
		<Tooltip onOpenChange={setIsOpen} open={isOpen}>
			<TooltipTrigger asChild>
				<Button
					className="h-6 w-6 p-0"
					onClick={handleCopy}
					onMouseEnter={() => {
						if (!hasCopied) setIsOpen(true);
					}}
					onMouseLeave={() => {
						if (!hasCopied) setIsOpen(false);
					}}
					size="sm"
					variant="ghost"
				>
					<Icon className="h-3 w-3" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>{hasCopied ? successLabel : label}</TooltipContent>
		</Tooltip>
	);
}
